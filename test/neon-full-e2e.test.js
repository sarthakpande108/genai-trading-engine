import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

function makeCandles(count, intervalMinutes, start = "2026-10-01T00:00:00.000Z") {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 0.5;
    return [
      new Date(startMs + index * intervalMinutes * 60_000).toISOString(),
      close - 0.2,
      close + 1,
      close - 1,
      close,
      1_000 + index * 10,
    ];
  });
}

test("Neon full application flow: startup, AI analysis, forecast outcomes and paper portfolio", {
  skip: !testDatabaseUrl,
}, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;

  const symbol = "E2E_" + randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const dailyHistory = makeCandles(25, 24 * 60);
  const dailyInput = dailyHistory.slice(0, 20);
  const intradayInput = makeCandles(20, 5);
  const analysis = {
    symbol,
    outlook: "BULLISH",
    horizon: "Next 1-5 trading sessions",
    directionalProbabilityPct: 65,
    confidenceLabel: "MEDIUM",
    executiveSummary: "Synthetic integration-test forecast.",
    trendAnalysis: "Synthetic upward trend.",
    indicatorAnalysis: ["Test indicators supplied."],
    bullishFactors: ["Synthetic higher closes."],
    bearishFactors: ["Synthetic test volatility."],
    supportLevels: [100],
    resistanceLevels: [115],
    invalidationCondition: "Synthetic invalidation below support.",
    risks: ["Synthetic data only."],
    scenario: "Integration test only.",
    dataLimitations: ["No live market data used."],
    marketContextAnalysis: "No benchmark context supplied.",
    newsAnalysis: "No news supplied.",
  };

  let predictionId;
  let query;
  let closeDatabase;

  try {
    // Importing the public entry point verifies that the application modules load.
    const app = await import("../index.js");
    query = app.queryDatabase;
    closeDatabase = app.closeDatabase;

    const startup = await query(
      "SELECT current_database() AS database_name, current_user AS database_user, NOW() AS connected_at"
    );
    assert.equal(startup.rowCount, 1, "application must connect to Neon at startup");

    const result = await app.analyzeStock({
      symbol,
      exchange: "NSE",
      companyName: "Synthetic E2E Instrument",
      apiKey: "integration-test-key",
      model: "integration-test-model",
      dailyCandles: dailyInput,
      intradayCandles: intradayInput,
      news: { status: "unavailable", provider: "test", articles: [] },
      trackPrediction: true,
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(analysis) }] } }],
        }),
      }),
    });

    assert.equal(result.analysis.symbol, symbol);
    assert.ok(result.prediction?.id, "analysis must persist a forecast");
    predictionId = result.prediction.id;

    const saved = (await app.listPredictions()).find((item) => item.id === predictionId);
    assert.ok(saved, "saved forecast must be readable through the application repository");
    assert.equal(saved.symbol, symbol);
    assert.equal(saved.baseClose, dailyInput.at(-1)[4]);
    assert.deepEqual(saved.horizonSessions, [1, 3, 5]);

    const evaluation = await app.evaluatePendingPredictions({
      fetchDailyCandles: async (requestedSymbol) =>
        requestedSymbol === symbol ? dailyHistory : [],
    });
    assert.ok(evaluation.updatedPredictionIds.includes(predictionId));

    const evaluated = (await app.listPredictions()).find((item) => item.id === predictionId);
    assert.equal(evaluated.outcomes[1].actualClose, dailyHistory[20][4]);
    assert.equal(evaluated.outcomes[3].actualClose, dailyHistory[22][4]);
    assert.equal(evaluated.outcomes[5].actualClose, dailyHistory[24][4]);
    assert.equal(evaluated.outcomes[1].actualDirection, "BULLISH");
    assert.equal(evaluated.outcomes[1].directionCorrect, true);

    // Paper-only execution: no broker adapter is supplied or invoked.
    const execution = app.createExecutionAdapter({
      mode: "paper",
      maxOrderNotional: 10_000,
      availableCapital: 10_000,
      persistPaperOrders: true,
    });
    assert.equal(execution.mode, "paper");

    const buy = await execution.placeOrder({
      symbol, side: "BUY", quantity: 4, price: 100,
      metadata: { testRun: true },
    });
    assert.equal(buy.accepted, true);
    assert.equal(buy.persisted, true);

    const sell = await execution.placeOrder({
      symbol, side: "SELL", quantity: 1, price: 110,
      metadata: { testRun: true },
    });
    assert.equal(sell.accepted, true);

    const orders = await execution.listPaperOrders({ limit: 20 });
    assert.equal(orders.filter((order) => order.symbol === symbol).length, 2);

    const { rows: positions } = await query(
      "SELECT quantity, average_price FROM paper_positions WHERE symbol = $1",
      [symbol]
    );
    assert.equal(positions.length, 1);
    assert.equal(Number(positions[0].quantity), 3);
    assert.equal(Number(positions[0].average_price), 100);

    await assert.rejects(
      execution.placeOrder({ symbol, side: "SELL", quantity: 4, price: 110 }),
      /exceeds the persisted position/
    );

    const { rows: finalOrders } = await query(
      "SELECT COUNT(*)::int AS count FROM paper_orders WHERE symbol = $1",
      [symbol]
    );
    assert.equal(finalOrders[0].count, 2, "rejected paper sell must not create an order");
  } finally {
    if (query) {
      await query("DELETE FROM predictions WHERE id = $1", [predictionId].filter(Boolean)).catch(() => {});
      await query("DELETE FROM paper_orders WHERE symbol = $1", [symbol]).catch(() => {});
      await query("DELETE FROM paper_positions WHERE symbol = $1", [symbol]).catch(() => {});
    }
    if (closeDatabase) await closeDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
