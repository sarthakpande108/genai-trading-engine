export const NEUTRAL_RETURN_BAND_PCT = 0.10;

export function classifyReturnDirection(returnPct, neutralBandPct = NEUTRAL_RETURN_BAND_PCT) {
  if (!Number.isFinite(returnPct) || !Number.isFinite(neutralBandPct) || neutralBandPct < 0) {
    throw new TypeError("returnPct and a non-negative neutralBandPct must be finite");
  }
  return returnPct > neutralBandPct ? "BULLISH"
    : returnPct < -neutralBandPct ? "BEARISH" : "NEUTRAL";
}

/**
 * Build horizon outcomes from unique, valid daily close observations.
 * Invalid candles are ignored. If one timestamp has conflicting closes, that
 * timestamp is excluded rather than choosing an arbitrary price.
 */
export function buildPredictionOutcomes({
  rows,
  baseTimestamp,
  baseClose,
  outlook,
  horizons = [1, 3, 5],
} = {}) {
  const baseTime = Date.parse(baseTimestamp);
  const normalizedBaseClose = Number(baseClose);
  if (!Number.isFinite(baseTime)) throw new TypeError("baseTimestamp must be a valid timestamp");
  if (!Number.isFinite(normalizedBaseClose) || normalizedBaseClose <= 0) {
    throw new TypeError("baseClose must be positive and finite");
  }
  if (!["BULLISH", "BEARISH", "NEUTRAL"].includes(outlook)) {
    throw new TypeError("outlook must be BULLISH, BEARISH or NEUTRAL");
  }
  if (!Array.isArray(horizons) || horizons.some((horizon) =>
    !Number.isInteger(horizon) || horizon <= 0
  ) || new Set(horizons).size !== horizons.length) {
    throw new TypeError("horizons must contain unique positive integers");
  }

  const byTimestamp = new Map();
  const conflictingTimestamps = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const timestampMs = Date.parse(row[0]);
    const close = Number(row[4]);
    if (!Number.isFinite(timestampMs) || !Number.isFinite(close) || close <= 0) continue;
    if (conflictingTimestamps.has(timestampMs)) continue;

    const existing = byTimestamp.get(timestampMs);
    if (!existing) {
      byTimestamp.set(timestampMs, {
        timestampMs,
        timestamp: new Date(timestampMs).toISOString(),
        close,
      });
    } else if (existing.close !== close) {
      byTimestamp.delete(timestampMs);
      conflictingTimestamps.add(timestampMs);
    }
  }

  const ordered = [...byTimestamp.values()].sort((a, b) => a.timestampMs - b.timestampMs);
  const baseIndex = ordered.findIndex((candle) => candle.timestampMs === baseTime);
  if (baseIndex < 0) return [];

  return horizons.flatMap((horizonSessions) => {
    const actual = ordered[baseIndex + horizonSessions];
    if (!actual) return [];
    const returnPct = (actual.close / normalizedBaseClose - 1) * 100;
    const actualDirection = classifyReturnDirection(returnPct);
    return [{
      horizonSessions,
      actualTimestamp: actual.timestamp,
      actualClose: actual.close,
      returnPct,
      actualDirection,
      directionCorrect: outlook === actualDirection,
    }];
  });
}
