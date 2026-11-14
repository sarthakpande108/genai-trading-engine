/**
 * Performance analytics for runBacktest() results.
 * Annualization assumes equally spaced observations.
 */

function finite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(name + " must be finite");
}

export function summarizeBacktest(result, { periodsPerYear = 252, riskFreeRate = 0 } = {}) {
  if (!result || !Array.isArray(result.equityCurve) || !Array.isArray(result.trades)) {
    throw new TypeError("result must contain equityCurve and trades arrays");
  }
  if (!Number.isInteger(periodsPerYear) || periodsPerYear < 1) {
    throw new RangeError("periodsPerYear must be a positive integer");
  }
  finite(riskFreeRate, "riskFreeRate");

  const curve = result.equityCurve;
  const equities = curve.map((point, index) => {
    if (!point || !Number.isFinite(point.equity) || point.equity <= 0) {
      throw new RangeError("equityCurve values must be positive and finite (index " + index + ")");
    }
    return point.equity;
  });
  const returns = equities.slice(1).map((value, index) => value / equities[index] - 1);
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const variance = returns.length > 1
    ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1)
    : 0;
  const volatility = Math.sqrt(variance);
  const annualizedVolatility = volatility * Math.sqrt(periodsPerYear);
  const periodicRiskFree = riskFreeRate / periodsPerYear;
  const sharpeRatio = volatility > 0
    ? ((mean - periodicRiskFree) / volatility) * Math.sqrt(periodsPerYear)
    : null;

  let peak = equities[0] ?? result.initialCapital;
  let maxDrawdown = 0;
  for (const equity of equities) {
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
  }

  const pnls = result.trades.map((trade, index) => {
    if (!trade || !Number.isFinite(trade.pnl)) {
      throw new TypeError("trade " + index + " must contain a finite pnl");
    }
    return trade.pnl;
  });
  const winners = pnls.filter((pnl) => pnl > 0);
  const losers = pnls.filter((pnl) => pnl < 0);
  const grossProfit = winners.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, pnl) => sum + pnl, 0));
  const firstEquity = equities[0] ?? result.initialCapital;
  const finalEquity = result.finalEquity ?? equities.at(-1) ?? result.initialCapital;
  const totalReturn = result.initialCapital > 0 ? finalEquity / result.initialCapital - 1 : null;
  const cagr = equities.length > 1 && totalReturn > -1
    ? (finalEquity / firstEquity) ** (periodsPerYear / (equities.length - 1)) - 1
    : null;

  return {
    totalReturn,
    cagr,
    annualizedVolatility,
    sharpeRatio,
    maxDrawdown,
    tradeCount: pnls.length,
    winRate: pnls.length ? winners.length / pnls.length : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : null),
    averageTradePnl: pnls.length ? pnls.reduce((sum, pnl) => sum + pnl, 0) / pnls.length : 0,
    grossProfit,
    grossLoss,
  };
}
