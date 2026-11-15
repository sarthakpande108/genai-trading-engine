import {
  fetchDailyCandlesWithTimestamps,
  fetchFiveMinuteCandlesWithTimestamps,
} from "./historicaldata.js";
import { buildMarketContext } from "./market-context.js";
import { fetchStockNews } from "./news.js";
import { recordPrediction, evaluatePendingPredictions } from "./prediction-tracker.js";
import { buildStockAnalysisPayload, analyzeStockDataWithGemini } from "./gemini-analysis.js";

export function assertFreshCandles(rows, label, maxAgeDays = 10, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length < 20) {
    throw new RangeError(`${label} market data must contain at least 20 candles`);
  }
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0 || !Number.isFinite(now)) {
    throw new RangeError("maxAgeDays and now must be positive/finite");
  }
  const timestamps = rows.map((row) => Date.parse(row?.[0]));
  if (timestamps.some((value) => !Number.isFinite(value))) {
    throw new TypeError(`${label} market data contains an invalid timestamp`);
  }
  for (let i = 1; i < timestamps.length; i += 1) {
    if (timestamps[i] <= timestamps[i - 1]) {
      throw new TypeError(`${label} market data must be strictly chronological and deduplicated`);
    }
  }
  const latest = timestamps.at(-1);
  if (latest > now + 5 * 60_000) throw new RangeError(`${label} market data timestamp is in the future`);
  let maxAgeMs = maxAgeDays * 24 * 60 * 60_000;
  if (label === "five-minute") {
    // NSE cash-market session in IST. During a weekday session, intraday
    // data older than 20 minutes is unsafe to use for a current analysis.
    // Outside session hours, allow a weekend/holiday buffer; this is a
    // conservative weekday schedule check, not an official holiday calendar.
    const ist = new Date(now + 330 * 60_000);
    const day = ist.getUTCDay();
    const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const weekday = day >= 1 && day <= 5;
    const sessionOpen = minutes >= 9 * 60 + 15 && minutes <= 15 * 60 + 30;
    if (weekday && sessionOpen) maxAgeMs = 20 * 60_000;
  }
  if (now - latest > maxAgeMs) {
    throw new RangeError(`${label} market data is stale; latest candle exceeds the allowed freshness window`);
  }
}

export async function analyzeStock({
  symbol, exchange = "NSE", companyName, apiKey, model, fetchImpl, timeoutMs,
  dailyCandles, intradayCandles, marketContext, marketContextSymbols,
  news, newsApiKey, newsFetchImpl, newsQuery, trackPrediction = true, strictMarketData = true,
} = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) throw new TypeError("symbol is required, e.g. RELIANCE");
  const injected = Array.isArray(dailyCandles) || Array.isArray(intradayCandles);
  const [daily, intraday] = await Promise.all([
    dailyCandles ?? fetchDailyCandlesWithTimestamps(symbol, exchange, { throwOnError: strictMarketData }),
    intradayCandles ?? fetchFiveMinuteCandlesWithTimestamps(symbol, exchange, { throwOnError: strictMarketData }),
  ]);
  if (strictMarketData) {
    // Validate supplied and broker-fetched candles alike. Injecting a fixture
    // must not silently become a production freshness-validation bypass.
    assertFreshCandles(daily, "daily", 5);
    assertFreshCandles(intraday, "five-minute", 4);
  }
  let resolvedMarketContext = marketContext;
  if (!resolvedMarketContext) {
    const symbols = marketContextSymbols || (injected ? null : { benchmark: "Nifty 50" });
    if (symbols) {
      const [benchmarkRows, sectorRows] = await Promise.all([
        symbols.benchmark ? fetchDailyCandlesWithTimestamps(symbols.benchmark, symbols.exchange || exchange).catch(() => []) : null,
        symbols.sector ? fetchDailyCandlesWithTimestamps(symbols.sector, symbols.exchange || exchange).catch(() => []) : null,
      ]);
      resolvedMarketContext = buildMarketContext({
        benchmarkCandles: benchmarkRows?.length ? benchmarkRows : undefined,
        sectorCandles: sectorRows?.length ? sectorRows : undefined,
        benchmarkName: symbols.benchmark || "Benchmark",
        sectorName: symbols.sector || null,
      });
    }
  }
  let resolvedNews = news;
  if (!resolvedNews) {
    try {
      resolvedNews = await fetchStockNews({
        query: newsQuery || (companyName ? `"${companyName}" OR ${symbol}` : symbol),
        apiKey: newsApiKey, fetchImpl: newsFetchImpl || globalThis.fetch,
        pageSize: 12,
        from: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        timeoutMs,
      });
    } catch (error) {
      resolvedNews = { status: "error", provider: "NewsAPI", articles: [], warning: error.message };
    }
  }
  const input = buildStockAnalysisPayload({
    symbol, exchange, dailyCandles: daily, intradayCandles: intraday,
    marketContext: resolvedMarketContext || null, news: resolvedNews || null,
  });
  const analysis = await analyzeStockDataWithGemini(input, { apiKey, model, fetchImpl, timeoutMs });
  const prediction = trackPrediction ? await recordPrediction({ analysis, input }) : null;
  return { input, analysis, prediction };
}

export function evaluateStockPredictions() {
  return evaluatePendingPredictions({
    fetchDailyCandles: (symbol, exchange, options) =>
      fetchDailyCandlesWithTimestamps(symbol, exchange, options),
  });
}
