import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStockAnalysisPayload,
  analyzeStockDataWithGemini,
} from "../gemini-analysis.js";
import { analyzeStock } from "../stock-analysis.js";

function makeCandles(count = 20, intervalMinutes = 1440) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.8;
    const date = new Date(Date.UTC(2026, 0, 1) + index * intervalMinutes * 60_000).toISOString();
    return [date, close - 0.2, close + 1, close - 1, close, 1000 + index * 10];
  });
}

const validAnalysis = {
  symbol: "RELIANCE", outlook: "BULLISH", horizon: "Next 1-5 trading sessions",
  directionalProbabilityPct: 63, confidenceLabel: "MEDIUM",
  executiveSummary: "Daily trend is positive with intraday confirmation.",
  trendAnalysis: "Higher closes and rising averages.",
  indicatorAnalysis: ["RSI is constructive."],
  bullishFactors: ["Price above short moving averages."],
  bearishFactors: ["Short-term volatility remains."],
  supportLevels: [110], resistanceLevels: [120],
  invalidationCondition: "A daily close below support.",
  risks: ["Only a short recent sample is supplied."],
  scenario: "Continuation is possible while support holds.",
  dataLimitations: ["No fundamentals or news included."],
};

test("stock payload includes daily and five-minute OHLCV and indicator snapshots", () => {
  const payload = buildStockAnalysisPayload({
    symbol: "reliance", exchange: "nse",
    dailyCandles: makeCandles(),
    intradayCandles: makeCandles(20, 5),
  });
  assert.equal(payload.symbol, "RELIANCE");
  assert.equal(payload.daily.candleCount, 20);
  assert.equal(payload.intraday5m.recentCandles.length, 20);
  assert.equal(payload.daily.indicators.rsi14, 100);
  assert.ok(Number.isFinite(payload.daily.indicators.atr14));
  assert.ok(Number.isFinite(payload.daily.indicators.sma20));
});

test("payload rejects malformed OHLC candles", () => {
  const candles = makeCandles();
  candles[5] = [candles[5][0], 100, 99, 98, 100, 1000];
  assert.throws(() => buildStockAnalysisPayload({
    symbol: "ABC", exchange: "NSE",
    dailyCandles: candles, intradayCandles: makeCandles(20, 5),
  }), /invalid candle data/);
});

test("Gemini client sends the complete payload and parses structured JSON", async () => {
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(validAnalysis) }] } }],
      }),
    };
  };
  const payload = buildStockAnalysisPayload({
    symbol: "RELIANCE", exchange: "NSE",
    dailyCandles: makeCandles(), intradayCandles: makeCandles(20, 5),
  });
  const result = await analyzeStockDataWithGemini(payload, {
    apiKey: "test-key", fetchImpl,
  });
  assert.equal(result.outlook, "BULLISH");
  assert.equal(result.directionalProbabilityPct, 63);
  assert.match(requestBody.contents[0].parts[0].text, /RELIANCE/);
  assert.match(requestBody.contents[0].parts[0].text, /intraday5m/);
  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
});

test("Gemini client rejects missing API key and invalid model output", async () => {
  await assert.rejects(
    analyzeStockDataWithGemini({}, { apiKey: "" }),
    /Missing GEMINI_API_KEY/,
  );
  await assert.rejects(
    analyzeStockDataWithGemini({}, {
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }),
      }),
    }),
    /failed analysis validation/,
  );
});

test("end-to-end analyzeStock can use injected candles without broker credentials", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validAnalysis) }] } }],
    }),
  });
  const result = await analyzeStock({
    symbol: "RELIANCE", exchange: "NSE", apiKey: "test-key", fetchImpl,
    dailyCandles: makeCandles(), intradayCandles: makeCandles(20, 5),
  });
  assert.equal(result.analysis.symbol, "RELIANCE");
  assert.equal(result.input.daily.candleCount, 20);
});
