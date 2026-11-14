import { readFile } from "node:fs/promises";
import { query, closeDatabase } from "../db.js";

try {
  const sql = await readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8");
  await query(sql);
  console.log("Database migration 001 applied.");
} finally {
  await closeDatabase();
}
