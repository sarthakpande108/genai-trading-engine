import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL before running migrations.");
}
if (new URL(connectionString).hostname.includes("-pooler")) {
  throw new Error("Migrations require a direct Neon connection. Set DATABASE_URL_UNPOOLED (hostname without -pooler).");
}

const pool = new Pool({
  connectionString,
  ssl: process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 10_000,
});

const migrations = [
  ["001_initial", "../migrations/001_initial.sql"],
  ["002_paper_portfolios", "../migrations/002_paper_portfolios.sql"],
];

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    for (const [version, file] of migrations) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version]
      );
      if (applied.rowCount > 0) {
        console.log(`Database migration ${version} already applied; skipping.`);
        continue;
      }
      const sql = await readFile(new URL(file, import.meta.url), "utf8");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      console.log(`Database migration ${version} applied.`);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
