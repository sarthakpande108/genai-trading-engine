/**
 * Pure technical indicators.
 * Inputs are numeric closes/highs/lows in chronological order (oldest first).
 * Functions return arrays aligned to the input; warm-up periods contain null.
 */

function numericSeries(values, label = "values") {
  if (!Array.isArray(values) || values.some((value) => !Number.isFinite(Number(value)))) {
    throw new TypeError(`${label} must be an array of finite numbers`);
  }
  return values.map(Number);
}

export function sma(values, period) {
  const data = numericSeries(values);
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
  const result = Array(data.length).fill(null);
  let rollingSum = 0;
  for (let i = 0; i < data.length; i += 1) {
    rollingSum += data[i];
    if (i >= period) rollingSum -= data[i - period];
    if (i >= period - 1) result[i] = rollingSum / period;
  }
  return result;
}

export function ema(values, period) {
  const data = numericSeries(values);
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
  const result = Array(data.length).fill(null);
  if (data.length < period) return result;
  const seed = data.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  result[period - 1] = seed;
  for (let i = period; i < data.length; i += 1) {
    result[i] = alpha * data[i] + (1 - alpha) * result[i - 1];
  }
  return result;
}

export function rsi(values, period = 14) {
  const data = numericSeries(values);
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
  const result = Array(data.length).fill(null);
  if (data.length <= period) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = data[i] - data[i - 1];
    gains += Math.max(change, 0);
    losses += Math.max(-change, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const value = () => avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss);
  result[period] = value();

  for (let i = period + 1; i < data.length; i += 1) {
    const change = data[i] - data[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = value();
  }
  return result;
}

export function trueRange(highs, lows, closes) {
  const high = numericSeries(highs, "highs");
  const low = numericSeries(lows, "lows");
  const close = numericSeries(closes, "closes");
  if (high.length !== low.length || high.length !== close.length) {
    throw new RangeError("highs, lows, and closes must have equal lengths");
  }
  return high.map((h, i) => {
    if (h < low[i]) throw new RangeError(`high is below low at index ${i}`);
    return i === 0
      ? h - low[i]
      : Math.max(h - low[i], Math.abs(h - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  });
}

export function atr(highs, lows, closes, period = 14) {
  if (!Number.isInteger(period) || period < 1) throw new RangeError("period must be a positive integer");
  const ranges = trueRange(highs, lows, closes);
  const result = Array(ranges.length).fill(null);
  if (ranges.length < period) return result;
  let current = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = current;
  for (let i = period; i < ranges.length; i += 1) {
    current = (current * (period - 1) + ranges[i]) / period;
    result[i] = current;
  }
  return result;
}
