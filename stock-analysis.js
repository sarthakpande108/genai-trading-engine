import {
  fetchDailyCandlesWithTimestamps,
  fetchFiveMinuteCandlesWithTimestamps,
} from "./historicaldata.js";
import { buildMarketContext } from "./market-context.js";
import { fetchStockNews } from "./news.js";
import { recordPrediction, evaluatePendingPredictions } from "./prediction-tracker.js";
import { buildStockAnalysisPayload, analyzeStockDataWithGemini } from "./gemini-analysis.js";

export async function analyzeStock({
  symbol, exchange = "NSE", companyName, apiKey, model, fetchImpl, timeoutMs,
  dailyCandles, intradayCandles, marketContext, marketContextSymbols,
  news, newsApiKey, newsFetchImpl, newsQuery, trackPrediction = true, strictMarketData = false,
} = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) throw new TypeError("symbol is required, e.g. RELIANCE");
  const injected = Array.isArray(dailyCandles) || Array.isArray(intradayCandles);
  const [daily, intraday] = await Promise.all([
    dailyCandles ?? fetchDailyCandlesWithTimestamps(symbol, exchange, { throwOnError: strictMarketData }),
    intradayCandles ?? fetchFiveMinuteCandlesWithTimestamps(symbol, exchange, { throwOnError: strictMarketData }),
  ]);
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
