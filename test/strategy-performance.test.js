import test from "node:test";
import assert from "node:assert/strict";
import { smaCrossoverSignals } from "../strategy.js";
import { summarizeBacktest } from "../performance.js";
import { runPortfolioBacktest } from "../portfolio-backtest.js";

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
  assert.ok(Math.abs(summary.totalReturn - 0.08) < 1e-12);
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

test("portfolio backtest rejects different timestamps across instruments", () => {
  assert.throws(() => runPortfolioBacktest({
    initialCapital: 1000,
    instruments: {
      AAA: { bars: [{ timestamp: "2026-01-01T10:00:00Z", open: 10, close: 10 }], signals: [0] },
      BBB: { bars: [{ timestamp: "2026-01-02T10:00:00Z", open: 10, close: 10 }], signals: [0] },
    },
  }), /timestamp-aligned/);
});

test("same-open exits release cash before alphabetically earlier entries", () => {
  const bars = [
    { open: 100, close: 100 },
    { open: 100, close: 100 },
    { open: 100, close: 100 },
  ];
  const result = runPortfolioBacktest({
    initialCapital: 1_000,
    feeBps: 0,
    slippageBps: 0,
    instruments: {
      AAA: { quantity: 10, bars, signals: [0, 1, 1] },
      ZZZ: { quantity: 10, bars, signals: [1, 0, 0] },
    },
  });

  assert.equal(result.skippedOrders.length, 0);
  assert.deepEqual(result.trades.map(({ symbol, exitIndex }) => [symbol, exitIndex]), [
    ["ZZZ", 2],
    ["AAA", 2],
  ]);
  assert.equal(result.tradeCount, 2);
  assert.equal(result.finalEquity, 1_000);
  assert.equal(result.assumptions.sameOpenOrderPriority, "exits_before_entries");
});
