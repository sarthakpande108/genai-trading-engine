import test from "node:test";
import assert from "node:assert/strict";
import { runPortfolioBacktest } from "../portfolio-backtest.js";
import { createExecutionAdapter } from "../execution.js";

test("portfolio backtest shares cash and liquidates positions at final close", () => {
  const result = runPortfolioBacktest({
    initialCapital: 1_000,
    feeBps: 0,
    slippageBps: 0,
    instruments: {
      AAA: { quantity: 5, bars: [{ open: 100, close: 100 }, { open: 100, close: 110 }], signals: [1, 1] },
      BBB: { quantity: 5, bars: [{ open: 100, close: 100 }, { open: 100, close: 110 }], signals: [1, 1] },
    },
  });
  assert.equal(result.tradeCount, 2);
  assert.equal(result.finalEquity, 1_100);
  assert.equal(result.skippedOrders.length, 0);
});

test("portfolio backtest rejects purchases that exceed shared cash", () => {
  const result = runPortfolioBacktest({
    initialCapital: 1_000,
    feeBps: 0,
    slippageBps: 0,
    instruments: {
      AAA: { quantity: 6, bars: [{ open: 100, close: 100 }, { open: 100, close: 100 }], signals: [1, 1] },
      BBB: { quantity: 6, bars: [{ open: 100, close: 100 }, { open: 100, close: 100 }], signals: [1, 1] },
    },
  });
  assert.equal(result.skippedOrders.length, 1);
  assert.equal(result.skippedOrders[0].reason, "INSUFFICIENT_CASH");
});

test("paper execution simulates approved orders without a broker call", async () => {
  const adapter = createExecutionAdapter({
    maxOrderNotional: 10_000,
    availableCapital: 10_000,
  });
  const result = await adapter.placeOrder({ symbol: "tcs", side: "BUY", quantity: 2, price: 100 });
  assert.equal(result.accepted, true);
  assert.equal(result.order.status, "SIMULATED");
  assert.equal(adapter.getPaperOrders().length, 1);
});

test("execution rejects unsafe live mode unless explicitly enabled", () => {
  assert.throws(() => createExecutionAdapter({
    mode: "live", maxOrderNotional: 10_000, availableCapital: 10_000,
    submitOrder: async () => ({ ok: true }),
  }), /Live orders are disabled/);
});

test("execution refuses an order that breaches configured notional limit", async () => {
  const adapter = createExecutionAdapter({
    maxOrderNotional: 100,
    availableCapital: 1_000,
  });
  const result = await adapter.placeOrder({ symbol: "ABC", side: "BUY", quantity: 2, price: 100 });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "RISK_CHECK_FAILED");
});


import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
test("Neon persists paper orders and updates positions atomically", { skip: !testDatabaseUrl }, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  const { query, closeDatabase } = await import("../db.js");
  const symbol = "TEST_PAPER_" + randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  try {
    const adapter = createExecutionAdapter({
      maxOrderNotional: 10_000,
      availableCapital: 10_000,
      persistPaperOrders: true,
    });
    const buy = await adapter.placeOrder({ symbol, side: "BUY", quantity: 4, price: 100 });
    assert.equal(buy.accepted, true);
    assert.equal(buy.persisted, true);
    const sell = await adapter.placeOrder({ symbol, side: "SELL", quantity: 1, price: 110 });
    assert.equal(sell.accepted, true);
    const orders = await adapter.listPaperOrders({ limit: 10 });
    assert.equal(orders.filter((order) => order.symbol === symbol).length, 2);
    const { rows } = await query("SELECT quantity, average_price FROM paper_positions WHERE symbol = $1", [symbol]);
    assert.equal(Number(rows[0].quantity), 3);
    assert.equal(Number(rows[0].average_price), 100);
    await assert.rejects(
      adapter.placeOrder({ symbol, side: "SELL", quantity: 4, price: 110 }),
      /exceeds the persisted position/
    );
  } finally {
    await query("DELETE FROM paper_orders WHERE symbol = $1", [symbol]);
    await query("DELETE FROM paper_positions WHERE symbol = $1", [symbol]);
    await closeDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
