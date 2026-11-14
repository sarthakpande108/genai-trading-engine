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
