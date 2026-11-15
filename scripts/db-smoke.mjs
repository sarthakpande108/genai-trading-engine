import { randomUUID } from "node:crypto";
import { query, withTransaction, closeDatabase } from "../db.js";

const id = randomUUID();
const now = new Date().toISOString();

try {
  const result = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO predictions
        (id, symbol, exchange, forecasted_at, base_candle_timestamp, base_close,
         outlook, directional_probability_pct, confidence_label, horizon_sessions, forecast)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [id, "NEON_E2E_TEST", "TEST", now, now, 123.45, "BULLISH", 65,
        "MEDIUM", [1, 3, 5], JSON.stringify({ smokeTest: true, source: "db:smoke" })]
    );
    const inserted = await client.query(
      "SELECT id, symbol, base_close, forecast FROM predictions WHERE id = $1",
      [id]
    );
    if (inserted.rowCount !== 1 ||
        inserted.rows[0].symbol !== "NEON_E2E_TEST" ||
        Number(inserted.rows[0].base_close) !== 123.45 ||
        inserted.rows[0].forecast?.smokeTest !== true) {
      throw new Error("Neon persistence read-after-write assertion failed.");
    }
    await client.query("DELETE FROM predictions WHERE id = $1", [id]);
    const deleted = await client.query("SELECT 1 FROM predictions WHERE id = $1", [id]);
    if (deleted.rowCount !== 0) throw new Error("Smoke-test cleanup assertion failed.");
    return { inserted: inserted.rowCount, deleted: deleted.rowCount };
  });
  // Also exercise the shared query helper outside the transaction.
  await query("SELECT 1 AS database_connection_ok");
  console.log("Neon DB smoke test passed:", JSON.stringify(result));
} finally {
  await closeDatabase();
}
