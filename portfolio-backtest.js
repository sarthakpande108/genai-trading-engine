/**
 * Cash-account portfolio backtester for multiple instruments.
 * Per-symbol signals are evaluated at close and executed at the next bar open.
 * Long-only, fixed quantity per symbol; no leverage, shorts, margin or partial fills.
 */

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + " must be positive and finite");
}

export function runPortfolioBacktest({
  instruments,
  initialCapital = 100_000,
  feeBps = 5,
  slippageBps = 2,
}) {
  positive(initialCapital, "initialCapital");
  if (!instruments || typeof instruments !== "object" || Array.isArray(instruments)) {
    throw new TypeError("instruments must be an object keyed by symbol");
  }
  if (![feeBps, slippageBps].every((value) => Number.isFinite(value) && value >= 0)) {
    throw new RangeError("feeBps and slippageBps must be non-negative");
  }

  const symbols = Object.keys(instruments).sort();
  if (!symbols.length) throw new RangeError("at least one instrument is required");
  const length = instruments[symbols[0]]?.bars?.length;
  if (!Number.isInteger(length) || length < 1) throw new RangeError("each instrument needs at least one bar");

  const hasTimestamps = symbols.map((symbol) => instruments[symbol]?.bars?.some((bar) => bar?.timestamp !== undefined));
  if (hasTimestamps.some(Boolean) && !hasTimestamps.every(Boolean)) {
    throw new RangeError("all instruments must provide timestamps when any instrument is timestamped");
  }
  if (hasTimestamps.some(Boolean) && hasTimestamps.every(Boolean)) {
    const reference = instruments[symbols[0]].bars.map((bar) => Date.parse(bar.timestamp));
    if (reference.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= reference[index - 1]))) throw new TypeError("instrument timestamps must be valid and strictly chronological");
    for (const symbol of symbols.slice(1)) {
      const current = instruments[symbol].bars.map((bar) => Date.parse(bar.timestamp));
      if (current.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= current[index - 1]) || value !== reference[index])) {
        throw new RangeError("instrument candles must be timestamp-aligned at every index: " + symbol);
      }
    }
  }

  for (const symbol of symbols) {
    const item = instruments[symbol];
    if (!item || !Array.isArray(item.bars) || !Array.isArray(item.signals) ||
        item.bars.length !== length || item.signals.length !== length) {
      throw new RangeError("all instruments must have equal-length bars and signals: " + symbol);
    }
    positive(item.quantity ?? 1, symbol + " quantity");
    item.bars.forEach((bar, index) => {
      if (!bar || !Number.isFinite(bar.open) || !Number.isFinite(bar.close) ||
          bar.open <= 0 || bar.close <= 0) {
        throw new TypeError("invalid OHLC prices for " + symbol + " at index " + index);
      }
      if (![0, 1].includes(item.signals[index])) {
        throw new RangeError("signals must be 0 or 1 for " + symbol);
      }
    });
  }

  let cash = initialCapital;
  const positions = Object.fromEntries(symbols.map((symbol) => [symbol, null]));
  const trades = [];
  const equityCurve = [];
  const skippedOrders = [];

  function execute(symbol, target, index, priceField = "open") {
    const item = instruments[symbol];
    const current = positions[symbol];
    const quantity = item.quantity ?? 1;
    const rawPrice = item.bars[index][priceField];
    if (target === 1 && !current) {
      const price = rawPrice * (1 + slippageBps / 10_000);
      const notional = price * quantity;
      const fee = notional * feeBps / 10_000;
      if (notional + fee > cash) {
        skippedOrders.push({ symbol, index, side: "BUY", reason: "INSUFFICIENT_CASH" });
        return;
      }
      cash -= notional + fee;
      positions[symbol] = { entryPrice: price, entryIndex: index, quantity };
    } else if (target === 0 && current) {
      const price = rawPrice * (1 - slippageBps / 10_000);
      const notional = price * quantity;
      const fee = notional * feeBps / 10_000;
      cash += notional - fee;
      const pnl = (price - current.entryPrice) * quantity -
        (current.entryPrice * quantity + notional) * feeBps / 10_000;
      trades.push({
        symbol, entryIndex: current.entryIndex, exitIndex: index,
        entryPrice: current.entryPrice, exitPrice: price, quantity, pnl,
      });
      positions[symbol] = null;
    }
  }

  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      for (const symbol of symbols) execute(symbol, instruments[symbol].signals[index - 1], index);
    }
    let equity = cash;
    for (const symbol of symbols) {
      const position = positions[symbol];
      if (position) equity += position.quantity * instruments[symbol].bars[index].close;
    }
    equityCurve.push({ index, equity, cash });
  }

  const last = length - 1;
  for (const symbol of symbols) {
    if (positions[symbol]) execute(symbol, 0, last, "close");
  }
  if (equityCurve.length) equityCurve[equityCurve.length - 1] = { index: last, equity: cash, cash };

  let peak = initialCapital;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    peak = Math.max(peak, point.equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }
  const finalEquity = equityCurve.at(-1)?.equity ?? initialCapital;
  return {
    initialCapital, finalEquity, totalReturn: finalEquity / initialCapital - 1,
    maxDrawdown, trades, tradeCount: trades.length, skippedOrders, equityCurve,
    assumptions: { execution: "next_bar_open", positionMode: "long_only_cash_account", feeBps, slippageBps },
  };
}
