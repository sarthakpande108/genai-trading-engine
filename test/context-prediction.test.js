import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    benchmarkCandles: candles(5), sectorCandles: candles(5).map((r, i) => { const scale = 1 + i * 0.01; return [r[0], r[1] * scale, r[2] * scale, r[3] * scale, r[4] * scale, r[5]]; }),
    benchmarkName: "NIFTY 50", sectorName: "NIFTY IT",
  });
  assert.equal(context.benchmark.name, "NIFTY 50");
  assert.ok(context.benchmark.changePct > 0);
  assert.ok(context.sector.changePct > context.benchmark.changePct);
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

test("prediction tracker records forecast and scores 1, 3 and 5 sessions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trading-engine-"));
  const storePath = join(dir, "predictions.json");
  try {
    const history = candles(8);
    const input = { symbol: "ABC", exchange: "NSE", daily: { latestCandle: { timestamp: history[0][0], close: history[0][4] } } };
    const analysis = { outlook: "BULLISH", directionalProbabilityPct: 65, confidenceLabel: "MEDIUM" };
    const saved = await recordPrediction({ analysis, input, storePath });
    assert.ok(saved.id);
    const result = await evaluatePendingPredictions({
      storePath,
      fetchDailyCandles: async () => history,
    });
    assert.equal(result.updatedPredictionIds.length, 1);
    const records = await listPredictions({ storePath });
    assert.equal(records[0].outcomes[1].actualClose, history[1][4]);
    assert.equal(records[0].outcomes[3].actualClose, history[3][4]);
    assert.equal(records[0].outcomes[5].actualClose, history[5][4]);
    assert.equal(records[0].outcomes[5].directionCorrect, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
