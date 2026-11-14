function normalizeCandles(rows, label) {
  if (!Array.isArray(rows) || rows.length < 2) throw new RangeError(label + " needs at least 2 timestamped candles");
  let previousTimestamp = -Infinity;
  return rows.map((row, index) => {
    if (!Array.isArray(row) || row.length < 6) throw new TypeError(label + " candle " + index + " must be [timestamp, open, high, low, close, volume]");
    const [timestamp, open, high, low, close, volume] = row;
    const timestampMs = Date.parse(timestamp);
    const values = [open, high, low, close, volume].map(Number);
    if (!Number.isFinite(timestampMs) || timestampMs <= previousTimestamp || values.some((v) => !Number.isFinite(v)) ||
        values.slice(0, 4).some((v) => v <= 0) || values[4] < 0 ||
        values[1] < values[2] || values[0] < values[2] || values[0] > values[1] ||
        values[3] < values[2] || values[3] > values[1]) {
      throw new TypeError(label + " contains invalid candle data at index " + index);
    }
    previousTimestamp = timestampMs;
    return { timestamp, open: values[0], high: values[1], low: values[2], close: values[3], volume: values[4] };
  });
}

export function buildMarketContext({ benchmarkCandles, sectorCandles, benchmarkName = "NIFTY 50", sectorName = null } = {}) {
  const summarize = (rows, name, label) => {
    if (!rows) return null;
    const candles = normalizeCandles(rows, label);
    const first = candles[0], last = candles.at(-1);
    const fiveSessionBase = candles[Math.max(0, candles.length - 6)];
    const high = Math.max(...candles.map((c) => c.high));
    const low = Math.min(...candles.map((c) => c.low));
    return {
      name, candleCount: candles.length, latestTimestamp: last.timestamp,
      latestClose: last.close,
      changePct: ((last.close / first.close) - 1) * 100,
      change5SessionsPct: ((last.close / fiveSessionBase.close) - 1) * 100,
      change20SessionsPct: ((last.close / first.close) - 1) * 100,
      recentHigh: high, recentLow: low,
      positionInRangePct: high === low ? 50 : ((last.close - low) / (high - low)) * 100,
      recentCandles: candles.slice(-10),
    };
  };
  const benchmark = summarize(benchmarkCandles, benchmarkName, "benchmark");
  const sector = summarize(sectorCandles, sectorName || "Sector index", "sector");
  return {
    benchmark,
    sector,
    sectorRelativeChangePct: benchmark && sector ? sector.changePct - benchmark.changePct : null,
    generatedAt: new Date().toISOString(),
    limitations: ["Benchmark and sector context use only the supplied recent daily candles; they are not a complete macroeconomic or market-breadth dataset."],
  };
}
