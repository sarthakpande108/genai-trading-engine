/**
 * Small, deterministic long/flat backtester.
 *
 * Signals are evaluated at bar close and executed at the NEXT bar open to
 * avoid look-ahead bias. A signal of 1 means target long; 0 means flat.
 * Quantity is fixed. No margin, partial fills, taxes, or corporate actions
 * are modeled; use this as a research primitive, not a live execution engine.
 */

function validPositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}

export function runBacktest({
  bars,
  signals,
  initialCapital = 100_000,
  quantity = 1,
  feeBps = 5,
  slippageBps = 2,
}) {
  if (!Array.isArray(bars) || !Array.isArray(signals) || bars.length !== signals.length) {
    throw new TypeError("bars and signals must be arrays of equal length");
  }
  validPositive(initialCapital, "initialCapital");
  validPositive(quantity, "quantity");
  if (![feeBps, slippageBps].every((v) => Number.isFinite(v) && v >= 0)) {
    throw new RangeError("feeBps and slippageBps must be non-negative");
  }

  bars.forEach((bar, i) => {
    if (!bar || !Number.isFinite(bar.open) || !Number.isFinite(bar.close) ||
        bar.open <= 0 || bar.close <= 0) {
      throw new TypeError(`bar ${i} must contain positive finite open and close prices`);
    }
    if (![0, 1].includes(signals[i])) throw new RangeError(`signal ${i} must be 0 (flat) or 1 (long)`);
  });

  let cash = initialCapital;
  let position = 0;
  let entryPrice = null;
  let entryIndex = null;
  let trades = [];
  const equityCurve = [];

  const execute = (target, barIndex) => {
    if (target === position || barIndex >= bars.length) return;
    const rawPrice = bars[barIndex].open;
    const direction = target > position ? 1 : -1;
    const executionPrice = rawPrice * (1 + direction * slippageBps / 10_000);
    const delta = (target - position) * quantity;
    const notional = Math.abs(delta * executionPrice);
    const fee = notional * feeBps / 10_000;
    cash -= delta * executionPrice + fee;

    if (target === 1) {
      entryPrice = executionPrice;
      entryIndex = barIndex;
    } else {
      const pnl = (executionPrice - entryPrice) * quantity -
        (entryPrice * quantity + executionPrice * quantity) * feeBps / 10_000 -
        (entryPrice + executionPrice) * quantity * slippageBps / 10_000;
      trades.push({ entryIndex, exitIndex: barIndex, entryPrice, exitPrice: executionPrice, pnl });
      entryPrice = null;
      entryIndex = null;
    }
    position = target;
  };

  for (let i = 0; i < bars.length; i += 1) {
    // Signal from prior close is executed at this bar's open.
    if (i > 0) execute(signals[i - 1], i);
    const equity = cash + position * quantity * bars[i].close;
    equityCurve.push({ index: i, equity });
  }

  // Liquidate any open position at the final close, with modeled costs.
  if (position === 1 && bars.length) {
    const rawPrice = bars[bars.length - 1].close;
    const exitPrice = rawPrice * (1 - slippageBps / 10_000);
    const fee = quantity * exitPrice * feeBps / 10_000;
    cash += quantity * exitPrice - fee;
    const pnl = (exitPrice - entryPrice) * quantity -
      (entryPrice * quantity + exitPrice * quantity) * feeBps / 10_000 -
      (entryPrice + exitPrice) * quantity * slippageBps / 10_000;
    trades.push({ entryIndex, exitIndex: bars.length - 1, entryPrice, exitPrice, pnl });
    position = 0;
    equityCurve[equityCurve.length - 1].equity = cash;
  }

  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }

  return {
    initialCapital,
    finalEquity,
    totalReturn: finalEquity / initialCapital - 1,
    maxDrawdown,
    tradeCount: trades.length,
    trades,
    equityCurve,
    assumptions: { execution: "next_bar_open", quantity, feeBps, slippageBps },
  };
}
