import test from "node:test";
import assert from "node:assert/strict";
import { calculateAverageCost, calculateSellRealizedPnl, calculatePortfolioValuation } from "../paper-portfolio-math.js";

test("weighted average entry cost includes fees from each buy", () => {
  const first = calculateAverageCost({ fillQuantity: 10, fillPrice: 100, feeBps: 10 });
  const combined = calculateAverageCost({
    existingQuantity: 10, existingAverageCost: first,
    fillQuantity: 5, fillPrice: 120, feeBps: 10,
  });
  assert.ok(Math.abs(first - 100.1) < 1e-10);
  assert.ok(Math.abs(combined - 106.77333333333333) < 1e-10);
});

test("sell realized P&L deducts the sell-side fee", () => {
  const pnl = calculateSellRealizedPnl({
    quantity: 5, averageCost: 106.77333333333333, fillPrice: 140, feeBps: 10,
  });
  assert.ok(Math.abs(pnl - 165.43333333333334) < 1e-10);
});

test("portfolio valuation normalizes symbols and requires every open position mark", () => {
  const value = calculatePortfolioValuation({
    cash: 1_000,
    positions: [
      { symbol: "reliance", quantity: "2", average_cost: "100" },
      { symbol: "TCS", quantity: 1, average_cost: 200 },
    ],
    prices: { reliance: 110, tcs: 220 },
  });
  assert.equal(value.marketValue, 440);
  assert.equal(value.equity, 1_440);
  assert.equal(value.unrealizedPnl, 40);
  assert.deepEqual(value.normalizedPrices, { RELIANCE: 110, TCS: 220 });
  assert.throws(() => calculatePortfolioValuation({
    cash: 1_000, positions: [{ symbol: "RELIANCE", quantity: 2, average_cost: 100 }], prices: {},
  }), /mark price for RELIANCE/);
});

test("portfolio math rejects invalid quantities, prices and fees", () => {
  assert.throws(() => calculateAverageCost({ fillQuantity: 0, fillPrice: 10 }), /fillQuantity/);
  assert.throws(() => calculateAverageCost({ fillQuantity: 1, fillPrice: 10, feeBps: -1 }), /feeBps/);
  assert.throws(() => calculateSellRealizedPnl({ quantity: 1, averageCost: 10, fillPrice: 0 }), /fillPrice/);
});
