import test from "node:test";
import assert from "node:assert/strict";
import { smaCrossoverSignals } from "../strategy.js";
import { summarizeBacktest } from "../performance.js";

test("SMA crossover stays flat during warm-up and enters on bullish crossover", () => {
  const signals = smaCrossoverSignals([5, 4, 3, 2, 1, 2, 3, 4, 5], {
    fastPeriod: 2,
    slowPeriod: 3,
  });
  assert.deepEqual(signals.slice(0, 4), [0, 0, 0, 0]);
  assert.equal(signals.at(-1), 1);
});

test("SMA crossover validates periods and prices", () => {
  assert.throws(() => smaCrossoverSignals([1, 2, 3], { fastPeriod: 3, slowPeriod: 2 }), RangeError);
  assert.throws(() => smaCrossoverSignals([1, 0, 3]), TypeError);
});

test("performance summary calculates returns, drawdown and trade statistics", () => {
  const summary = summarizeBacktest({
    initialCapital: 100,
    finalEquity: 108,
    equityCurve: [{ equity: 100 }, { equity: 110 }, { equity: 105 }, { equity: 108 }],
    trades: [{ pnl: 12 }, { pnl: -4 }],
  }, { periodsPerYear: 3 });
  assert.equal(summary.totalReturn, 0.08);
  assert.equal(summary.maxDrawdown, 5 / 110);
  assert.equal(summary.tradeCount, 2);
  assert.equal(summary.winRate, 0.5);
  assert.equal(summary.grossProfit, 12);
  assert.equal(summary.grossLoss, 4);
  assert.equal(summary.profitFactor, 3);
});

test("performance summary handles no trades and zero volatility", () => {
  const summary = summarizeBacktest({
    initialCapital: 100,
    finalEquity: 100,
    equityCurve: [{ equity: 100 }, { equity: 100 }],
    trades: [],
  });
  assert.equal(summary.sharpeRatio, null);
  assert.equal(summary.winRate, 0);
  assert.equal(summary.profitFactor, null);
});
