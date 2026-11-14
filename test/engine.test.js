import test from "node:test";
import assert from "node:assert/strict";
import { sma, ema, rsi, trueRange, atr } from "../indicator.js";
import { calculatePositionSize, validateOrderRisk } from "../risk.js";
import { runBacktest } from "../backtest.js";

test("SMA uses rolling windows and null warm-up", () => {
  assert.deepEqual(sma([1, 2, 3, 4], 3), [null, null, 2, 3]);
});

test("EMA seeds with an initial simple average", () => {
  const values = ema([10, 11, 12, 13], 3);
  assert.deepEqual(values.slice(0, 2), [null, null]);
  assert.equal(values[2], 11);
  assert.ok(Math.abs(values[3] - 12) < 1e-12);
});

test("RSI handles monotonic gains and losses", () => {
  assert.equal(rsi([1, 2, 3, 4], 2)[2], 100);
  assert.equal(rsi([4, 3, 2, 1], 2)[2], 0);
});

test("true range includes previous-close gaps and ATR smooths it", () => {
  const tr = trueRange([10, 12], [8, 9], [9, 11]);
  assert.deepEqual(tr, [2, 3]);
  assert.deepEqual(atr([10, 12], [8, 9], [9, 11], 2), [null, 2.5]);
});

test("position sizing respects risk, notional and lot constraints", () => {
  const result = calculatePositionSize({
    equity: 100_000, riskFraction: 0.01,
    entryPrice: 100, stopPrice: 95, maxNotionalFraction: 0.5, lotSize: 10,
  });
  assert.equal(result.quantity, 200);
  assert.equal(result.estimatedLossAtStop, 1_000);
  assert.equal(result.estimatedNotional, 20_000);
});

test("order risk guard reports violations without side effects", () => {
  assert.deepEqual(
    validateOrderRisk({
      side: "BUY", quantity: 20, price: 100,
      maxOrderNotional: 1_000, availableCapital: 1_500,
    }).violations,
    ["MAX_ORDER_NOTIONAL_EXCEEDED", "INSUFFICIENT_AVAILABLE_CAPITAL"]
  );
});

test("backtest executes close signals on next bar open and includes costs", () => {
  const result = runBacktest({
    bars: [
      { open: 100, close: 100 },
      { open: 101, close: 102 },
      { open: 103, close: 104 },
    ],
    signals: [1, 0, 0],
    initialCapital: 1_000,
    quantity: 1,
    feeBps: 0,
    slippageBps: 0,
  });
  assert.equal(result.tradeCount, 1);
  assert.equal(result.trades[0].entryIndex, 1);
  assert.equal(result.trades[0].exitIndex, 2);
  assert.equal(result.trades[0].pnl, 2);
  assert.equal(result.finalEquity, 1_002);
});

test("backtest rejects invalid signal values", () => {
  assert.throws(() => runBacktest({
    bars: [{ open: 10, close: 10 }],
    signals: [2],
  }), RangeError);
});
