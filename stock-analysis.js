import {
  fetchDailyCandlesWithTimestamps,
  fetchFiveMinuteCandlesWithTimestamps,
} from "./historicaldata.js";
import {
  buildStockAnalysisPayload,
  analyzeStockDataWithGemini,
} from "./gemini-analysis.js";

/**
 * End-to-end stock analysis:
 * Angel One daily + five-minute OHLCV -> technical indicators -> Gemini.
 * No order is placed and no trading signal is auto-executed.
 */
export async function analyzeStock({
  symbol,
  exchange = "NSE",
  apiKey,
  model,
  fetchImpl,
  timeoutMs,
  dailyCandles,
  intradayCandles,
} = {}) {
  if (typeof symbol !== "string" || !symbol.trim()) {
    throw new TypeError("symbol is required, e.g. RELIANCE");
  }

  const [daily, intraday] = await Promise.all([
    dailyCandles ?? fetchDailyCandlesWithTimestamps(symbol, exchange),
    intradayCandles ?? fetchFiveMinuteCandlesWithTimestamps(symbol, exchange),
  ]);
  const payload = buildStockAnalysisPayload({
    symbol, exchange, dailyCandles: daily, intradayCandles: intraday,
  });
  const analysis = await analyzeStockDataWithGemini(payload, {
    apiKey, model, fetchImpl, timeoutMs,
  });
  return { input: payload, analysis };
}
