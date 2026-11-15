import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStockAnalysisPayload,
  analyzeStockDataWithGemini,
} from "../gemini-analysis.js";
import { analyzeStock, assertFreshCandles } from "../stock-analysis.js";

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
  marketContextAnalysis: "No benchmark context supplied.",
  newsAnalysis: "No news articles supplied.",
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
  assert.equal(requestBody.generationConfig.temperature, undefined);
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
    dailyCandles: makeCandles(), intradayCandles: makeCandles(20, 5), trackPrediction: false,
    strictMarketData: false, // historical fixtures are intentionally outside the freshness window
  });
  assert.equal(result.analysis.symbol, "RELIANCE");
  assert.equal(result.input.daily.candleCount, 20);
});

test("Gemini accepts bearish directional probability and rejects impossible price levels", async () => {
  const payload = buildStockAnalysisPayload({
    symbol: "RELIANCE", exchange: "NSE",
    dailyCandles: makeCandles(), intradayCandles: makeCandles(20, 5),
  });
  const bearish = { ...validAnalysis, outlook: "BEARISH", directionalProbabilityPct: 68 };
  const ok = await analyzeStockDataWithGemini(payload, {
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers["x-goog-api-key"], "test-key");
      assert.equal(new URL(_url).searchParams.has("key"), false);
      assert.equal(JSON.parse(options.body).generationConfig.temperature, undefined);
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(bearish) }] } }] }) };
    },
  });
  assert.equal(ok.directionalProbabilityPct, 68);
  await assert.rejects(analyzeStockDataWithGemini(payload, {
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ...validAnalysis, supportLevels: [-1] }) }] } }] }) }),
  }), /failed analysis validation/);
});

test("broker candle freshness validator rejects stale, future and unordered data", () => {
  const now = Date.UTC(2026, 10, 15, 12);
  const fresh = Array.from({ length: 20 }, (_, i) => [
    new Date(now - (19 - i) * 60_000).toISOString(), 100, 101, 99, 100, 1000,
  ]);
  assert.doesNotThrow(() => assertFreshCandles(fresh, "five-minute", 10, now));
  assert.throws(() => assertFreshCandles(fresh.map((row, i) => [new Date(now - 11 * 86400_000 + i * 60_000).toISOString(), ...row.slice(1)]), "daily", 10, now), /stale/);
  const future = fresh.map((row) => [...row]);
  future[19][0] = new Date(now + 10 * 60_000).toISOString();
  assert.throws(() => assertFreshCandles(future, "five-minute", 10, now), /future/);
  const unordered = fresh.map((row) => [...row]);
  unordered[19][0] = unordered[18][0];
  assert.throws(() => assertFreshCandles(unordered, "five-minute", 10, now), /chronological/);

  // 12:00 IST is an active NSE session. A one-hour-old five-minute feed
  // must fail even though it is inside the weekend/holiday allowance.
  const sessionNow = Date.UTC(2026, 10, 16, 6, 30);
  const staleIntraday = Array.from({ length: 20 }, (_, i) => [
    new Date(sessionNow - 60 * 60_000 + i * 60_000).toISOString(), 100, 101, 99, 100, 1000,
  ]);
  assert.throws(() => assertFreshCandles(staleIntraday, "five-minute", 4, sessionNow), /stale/);

  // Outside session hours, a prior-session feed remains acceptable across a weekend.
  const mondayPreOpen = Date.UTC(2026, 10, 16, 2, 30); // 08:00 IST
  const fridayFeed = Array.from({ length: 20 }, (_, i) => [
    new Date(mondayPreOpen - 60 * 60 * 60_000 + i * 60_000).toISOString(), 100, 101, 99, 100, 1000,
  ]);
  assert.doesNotThrow(() => assertFreshCandles(fridayFeed, "five-minute", 4, mondayPreOpen));
});


test("Gemini rejects 50 percent directional estimates and support/resistance on wrong side of price", async () => {
  const payload = buildStockAnalysisPayload({
    symbol: "RELIANCE", exchange: "NSE",
    dailyCandles: makeCandles(), intradayCandles: makeCandles(20, 5),
  });
  const invalid = [
    { ...validAnalysis, directionalProbabilityPct: 50 },
    { ...validAnalysis, supportLevels: [999] },
    { ...validAnalysis, resistanceLevels: [1] },
  ];
  for (const analysis of invalid) {
    await assert.rejects(analyzeStockDataWithGemini(payload, {
      apiKey: "test-key",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }] }),
      }),
    }), /failed analysis validation/);
  }
});
