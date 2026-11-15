import { randomUUID } from "node:crypto";
import { query, withTransaction } from "./db.js";

function normalizePrediction(row) {
  return {
    id: row.id,
    symbol: row.symbol,
    exchange: row.exchange,
    forecastedAt: new Date(row.forecasted_at).toISOString(),
    baseCandleTimestamp: new Date(row.base_candle_timestamp).toISOString(),
    baseClose: Number(row.base_close),
    outlook: row.outlook,
    directionalProbabilityPct: Number(row.directional_probability_pct),
    confidenceLabel: row.confidence_label,
    horizonSessions: row.horizon_sessions,
    outcomes: row.outcomes || { 1: null, 3: null, 5: null },
    forecast: row.forecast,
  };
}

export async function recordPrediction({ analysis, input } = {}) {
  const base = input?.daily?.latestCandle;
  if (!analysis || !input?.symbol || !base ||
      !Number.isFinite(Number(base.close)) || Number(base.close) <= 0 ||
      !Number.isFinite(Date.parse(base.timestamp))) {
    throw new TypeError("analysis and a valid daily latestCandle are required to record a prediction");
  }
  if (!["BULLISH", "BEARISH", "NEUTRAL"].includes(analysis.outlook) ||
      !Number.isFinite(analysis.directionalProbabilityPct) ||
      analysis.directionalProbabilityPct < 50 || analysis.directionalProbabilityPct > 90 ||
      (analysis.outlook === "NEUTRAL" && analysis.directionalProbabilityPct !== 50)) {
    throw new TypeError("analysis contains invalid forecast direction or probability");
  }
  const record = {
    id: randomUUID(),
    symbol: input.symbol.trim().toUpperCase(),
    exchange: String(input.exchange || "NSE").trim().toUpperCase(),
    forecastedAt: new Date().toISOString(),
    baseCandleTimestamp: new Date(base.timestamp).toISOString(),
    baseClose: Number(base.close),
    outlook: analysis.outlook,
    directionalProbabilityPct: analysis.directionalProbabilityPct,
    confidenceLabel: analysis.confidenceLabel,
    horizonSessions: [1, 3, 5],
    forecast: analysis,
  };
  await query(
    `INSERT INTO predictions
      (id, symbol, exchange, forecasted_at, base_candle_timestamp, base_close,
       outlook, directional_probability_pct, confidence_label, horizon_sessions, forecast)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
    [record.id, record.symbol, record.exchange, record.forecastedAt,
      record.baseCandleTimestamp, record.baseClose, record.outlook,
      record.directionalProbabilityPct, record.confidenceLabel,
      record.horizonSessions, JSON.stringify(record.forecast)]
  );
  return { id: record.id, baseClose: record.baseClose, horizonSessions: record.horizonSessions };
}

/**
 * Score pending forecasts against timestamped daily candles.
 * The callback must return ascending [timestamp, open, high, low, close, volume] rows.
 */
export async function evaluatePendingPredictions({ fetchDailyCandles } = {}) {
  if (typeof fetchDailyCandles !== "function") throw new TypeError("fetchDailyCandles callback is required");
  const { rows: pending } = await query(
    `SELECT p.*,
       COALESCE(jsonb_object_agg(o.horizon_sessions, jsonb_build_object(
         'evaluatedAt', o.evaluated_at, 'actualTimestamp', o.actual_timestamp,
         'actualClose', o.actual_close, 'returnPct', o.return_pct,
         'actualDirection', o.actual_direction, 'directionCorrect', o.direction_correct
       )) FILTER (WHERE o.prediction_id IS NOT NULL), '{}'::jsonb) AS outcomes
     FROM predictions p
     LEFT JOIN prediction_outcomes o ON o.prediction_id = p.id
     GROUP BY p.id
     ORDER BY p.forecasted_at ASC`
  );
  const updated = [];
  for (const prediction of pending) {
    const outcomes = prediction.outcomes || {};
    const missing = [1, 3, 5].filter((h) => !outcomes[String(h)]);
    if (!missing.length) continue;
    const rows = await fetchDailyCandles(prediction.symbol, prediction.exchange, {
      // Include the base session even when the broker API treats fromdate as exclusive.
      from: new Date(new Date(prediction.base_candle_timestamp).getTime() - 24 * 60 * 60 * 1000),
    });
    if (!Array.isArray(rows)) continue;
    const baseTime = new Date(prediction.base_candle_timestamp).getTime();
    const ordered = [...rows].sort((a, b) => Date.parse(a?.[0]) - Date.parse(b?.[0]));
    const baseIndex = ordered.findIndex((row) => Date.parse(row?.[0]) === baseTime);
    if (baseIndex < 0) continue;
    for (const horizon of missing) {
      const row = ordered[baseIndex + horizon];
      if (!row) continue;
      const actualClose = Number(row[4]);
      if (!Number.isFinite(actualClose) || actualClose <= 0) continue;
      const returnPct = (actualClose / Number(prediction.base_close) - 1) * 100;
      const actualDirection = returnPct > 0 ? "BULLISH" : returnPct < 0 ? "BEARISH" : "NEUTRAL";
      const directionCorrect = prediction.outlook === "NEUTRAL"
        ? actualDirection === "NEUTRAL"
        : prediction.outlook === actualDirection;
      await query(
        `INSERT INTO prediction_outcomes
          (prediction_id, horizon_sessions, actual_timestamp, actual_close, return_pct, actual_direction, direction_correct)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (prediction_id, horizon_sessions) DO NOTHING`,
        [prediction.id, horizon, new Date(row[0]).toISOString(), actualClose,
          returnPct, actualDirection, directionCorrect]
      );
    }
    updated.push(prediction.id);
  }
  return { updatedPredictionIds: updated, totalPredictions: pending.length };
}

export async function listPredictions() {
  const { rows } = await query(
    `SELECT p.*,
       COALESCE(jsonb_object_agg(o.horizon_sessions, jsonb_build_object(
         'evaluatedAt', o.evaluated_at, 'actualTimestamp', o.actual_timestamp,
         'actualClose', o.actual_close, 'returnPct', o.return_pct,
         'actualDirection', o.actual_direction, 'directionCorrect', o.direction_correct
       )) FILTER (WHERE o.prediction_id IS NOT NULL), '{}'::jsonb) AS outcomes
     FROM predictions p
     LEFT JOIN prediction_outcomes o ON o.prediction_id = p.id
     GROUP BY p.id ORDER BY p.forecasted_at DESC`
  );
  return rows.map(normalizePrediction);
}
