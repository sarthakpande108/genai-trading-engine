/**
 * Deterministic strategy helpers.
 * Signals are generated from completed candle closes and are intended to be
 * consumed by the next-bar-open backtester.
 */

function validateSeries(values, label) {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new TypeError(label + " must be an array of positive finite numbers");
  }
}

export function smaCrossoverSignals(closes, { fastPeriod = 10, slowPeriod = 30 } = {}) {
  validateSeries(closes, "closes");
  if (!Number.isInteger(fastPeriod) || fastPeriod < 1 ||
      !Number.isInteger(slowPeriod) || slowPeriod < 2 ||
      fastPeriod >= slowPeriod) {
    throw new RangeError("Periods must be positive integers and fastPeriod must be less than slowPeriod");
  }

  const signals = Array(closes.length).fill(0);
  let position = 0;
  let fastSum = 0;
  let slowSum = 0;

  for (let i = 0; i < closes.length; i += 1) {
    fastSum += closes[i];
    slowSum += closes[i];
    if (i >= fastPeriod) fastSum -= closes[i - fastPeriod];
    if (i >= slowPeriod) slowSum -= closes[i - slowPeriod];

    if (i >= slowPeriod - 1) {
      const fast = fastSum / fastPeriod;
      const slow = slowSum / slowPeriod;
      if (fast > slow) position = 1;
      else if (fast < slow) position = 0;
    }
    signals[i] = position;
  }

  return signals;
}
