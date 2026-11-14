import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";

const writeQueues = new Map();

async function readStore(storePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(storePath, "utf8"));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.predictions)) throw new Error("Invalid prediction store format");
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, predictions: [] };
    throw error;
  }
}

async function updateStore(storePath, updater) {
  const previous = writeQueues.get(storePath) || Promise.resolve();
  const next = previous.then(async () => {
    const store = await readStore(storePath);
    const result = await updater(store);
    await fs.mkdir((await import("node:path")).dirname(storePath), { recursive: true });
    const tempPath = storePath + "." + randomUUID() + ".tmp";
    await fs.writeFile(tempPath, JSON.stringify(store, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await fs.rename(tempPath, storePath);
    return result;
  });
  writeQueues.set(storePath, next.catch(() => {}));
  return next;
}

/** Persist the exact forecast and the close/timestamp from which it was made. */
export async function recordPrediction({ analysis, input, storePath = process.env.PREDICTION_STORE_PATH || "./data/predictions.json" } = {}) {
  const base = input?.daily?.latestCandle;
  if (!analysis || !input?.symbol || !base || !Number.isFinite(Number(base.close)) || !Number.isFinite(Date.parse(base.timestamp))) {
    throw new TypeError("analysis and a valid daily latestCandle are required to record a prediction");
  }
  const record = {
    id: randomUUID(), symbol: input.symbol, exchange: input.exchange,
    forecastedAt: new Date().toISOString(),
    baseCandleTimestamp: base.timestamp, baseClose: Number(base.close),
    outlook: analysis.outlook,
    directionalProbabilityPct: analysis.directionalProbabilityPct,
    confidenceLabel: analysis.confidenceLabel,
    horizonSessions: [1, 3, 5],
    outcomes: { 1: null, 3: null, 5: null },
    forecast: analysis,
  };
  await updateStore(storePath, (store) => { store.predictions.push(record); return record; });
  return { id: record.id, storePath, baseClose: record.baseClose, horizonSessions: record.horizonSessions };
}

/**
 * Score pending forecasts against timestamped daily candles.
 * fetchDailyCandles(symbol, exchange) must return [timestamp, open, high, low, close, volume] rows.
 */
export async function evaluatePendingPredictions({
  fetchDailyCandles, storePath = process.env.PREDICTION_STORE_PATH || "./data/predictions.json",
} = {}) {
  if (typeof fetchDailyCandles !== "function") throw new TypeError("fetchDailyCandles callback is required");
  return updateStore(storePath, async (store) => {
    const symbols = [...new Set(store.predictions.filter((p) => [1, 3, 5].some((h) => !p.outcomes[h])).map((p) => p.symbol + "|" + p.exchange))];
    const candleMap = new Map();
    await Promise.all(symbols.map(async (key) => {
      const [symbol, exchange] = key.split("|");
      candleMap.set(key, await fetchDailyCandles(symbol, exchange));
    }));
    const updated = [];
    for (const prediction of store.predictions) {
      const rows = candleMap.get(prediction.symbol + "|" + prediction.exchange);
      if (!Array.isArray(rows)) continue;
      const baseIndex = rows.findIndex((row) => row?.[0] === prediction.baseCandleTimestamp);
      if (baseIndex < 0) continue;
      for (const horizon of [1, 3, 5]) {
        if (prediction.outcomes[horizon] || !rows[baseIndex + horizon]) continue;
        const row = rows[baseIndex + horizon];
        const actualClose = Number(row[4]);
        if (!Number.isFinite(actualClose) || actualClose <= 0) continue;
        const returnPct = ((actualClose / prediction.baseClose) - 1) * 100;
        const actualDirection = returnPct > 0 ? "BULLISH" : returnPct < 0 ? "BEARISH" : "NEUTRAL";
        prediction.outcomes[horizon] = {
          evaluatedAt: new Date().toISOString(), actualTimestamp: row[0],
          actualClose, returnPct, actualDirection,
          directionCorrect: prediction.outlook === "NEUTRAL" ? actualDirection === "NEUTRAL" : prediction.outlook === actualDirection,
        };
      }
      updated.push(prediction.id);
    }
    return { updatedPredictionIds: updated, totalPredictions: store.predictions.length };
  });
}

export async function listPredictions({ storePath = process.env.PREDICTION_STORE_PATH || "./data/predictions.json" } = {}) {
  return (await readStore(storePath)).predictions;
}
