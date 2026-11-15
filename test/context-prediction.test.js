import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketContext } from "../market-context.js";
import { normalizeNewsArticles } from "../news.js";
import { recordPrediction, evaluatePendingPredictions, listPredictions } from "../prediction-tracker.js";

function candles(count = 8) {
  return Array.from({ length: count }, (_, i) => {
    const close = 100 + i;
    return [new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), close, close + 1, close - 1, close, 1000];
  });
}

test("market context summarizes benchmark and sector relative moves", () => {
  const context = buildMarketContext({
    benchmarkCandles: candles(5),
    sectorCandles: candles(5).map((r, i) => { const scale = 1 + i * 0.01; return [r[0], r[1] * scale, r[2] * scale, r[3] * scale, r[4] * scale, r[5]]; }),
    benchmarkName: "NIFTY 50", sectorName: "NIFTY IT",
  });
  assert.equal(context.benchmark.name, "NIFTY 50");
  assert.ok(context.benchmark.changeWindowPct > 0);
  assert.ok(context.sector.changeWindowPct > context.benchmark.changeWindowPct);
});

test("news normalizer keeps source, title, URL and valid publication time", () => {
  const items = normalizeNewsArticles([
    { source: { name: "Publisher" }, title: "Company update", description: "Details", url: "https://example.com/a", publishedAt: "2026-11-14T08:00:00Z" },
    { title: "No date", url: "https://example.com/b" },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, "Publisher");
  assert.equal(items[0].url, "https://example.com/a");
});

// Never fall back to DATABASE_URL here: this test inserts and deletes records.
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
test("Neon PostgreSQL persists forecasts and evaluates 1/3/5-session outcomes", { skip: !testDatabaseUrl }, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  const { query, closeDatabase } = await import("../db.js");
  let savedId;
  try {
    const { rows } = await query("SELECT to_regclass('public.predictions') AS predictions, to_regclass('public.prediction_outcomes') AS outcomes");
    assert.ok(rows[0].predictions, "run npm run db:migrate before database integration tests");
    assert.ok(rows[0].outcomes);
    const history = candles(8);
    const input = { symbol: "TEST_NEON", exchange: "NSE", daily: { latestCandle: { timestamp: history[0][0], close: history[0][4] } } };
    const analysis = { outlook: "BULLISH", directionalProbabilityPct: 65, confidenceLabel: "MEDIUM" };
    const saved = await recordPrediction({ analysis, input });
    savedId = saved.id;
    assert.ok(saved.id);
    const result = await evaluatePendingPredictions({ fetchDailyCandles: async () => history });
    assert.ok(result.updatedPredictionIds.includes(saved.id));
    const records = await listPredictions();
    const record = records.find((item) => item.id === saved.id);
    assert.equal(record.outcomes[1].actualClose, history[1][4]);
    assert.equal(record.outcomes[3].actualClose, history[3][4]);
    assert.equal(record.outcomes[5].actualClose, history[5][4]);
  } finally {
    if (savedId) await query("DELETE FROM predictions WHERE id = $1", [savedId]);
    await closeDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
