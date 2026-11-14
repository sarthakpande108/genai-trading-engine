// Utilities for broker instrument metadata and exchange-local timestamps.
import { promises as fs } from "node:fs";
import https from "node:https";

const IST_OFFSET_MINUTES = 330;
const DEFAULT_MASTER_URL =
  "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

/**
 * Format a UTC Date as the timestamp format expected by SmartAPI.
 * The input Date represents an absolute instant; conversion is performed
 * exactly once to avoid host-machine timezone dependence.
 */
export function formatToIST(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError("formatToIST expects a valid Date");
  }

  const istDate = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const yyyy = istDate.getUTCFullYear();
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(istDate.getUTCDate()).padStart(2, "0");
  const hh = String(istDate.getUTCHours()).padStart(2, "0");
  const min = String(istDate.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

/**
 * Download the broker scrip master with a bounded response size and timeout.
 * A fresh on-disk cache is preferred; corrupt cache entries are ignored.
 */
export async function downloadScripMaster(
  cachePath = "./scripMaster.json",
  {
    maxAgeMs = 60 * 60 * 1000,
    timeoutMs = 15_000,
    maxBytes = 50 * 1024 * 1024,
    url = DEFAULT_MASTER_URL,
  } = {}
) {
  try {
    const stat = await fs.stat(cachePath);
    if (Date.now() - stat.mtimeMs < maxAgeMs) {
      const cached = JSON.parse(await fs.readFile(cachePath, "utf8"));
      if (Array.isArray(cached)) return cached;
    }
  } catch {
    // Missing, stale, or invalid cache: attempt a fresh download.
  }

  try {
    const raw = await new Promise((resolve, reject) => {
      const request = https.get(url, { timeout: timeoutMs }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`Scrip master request failed: HTTP ${response.statusCode}`));
          return;
        }

        let body = "";
        let bytes = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          bytes += Buffer.byteLength(chunk);
          if (bytes > maxBytes) {
            request.destroy(new Error("Scrip master exceeded configured size limit"));
            return;
          }
          body += chunk;
        });
        response.on("end", () => resolve(body));
        response.on("error", reject);
      });
      request.on("timeout", () => request.destroy(new Error("Scrip master request timed out")));
      request.on("error", reject);
    });

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("Scrip master payload must be a JSON array");
    }
    await fs.writeFile(cachePath, raw, { encoding: "utf8" });
    return parsed;
  } catch (error) {
    console.warn("Unable to refresh scrip master:", error.message);
    return null;
  }
}

function normalize(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * Resolve an exact exchange/symbol match, allowing the common -EQ suffix.
 * Returns null on ambiguity or missing data; never guesses another instrument.
 */
export function findSymbolToken(master, exchange, tradingsymbol) {
  if (!Array.isArray(master)) return null;

  const wantedExchange = normalize(exchange);
  const wantedSymbol = normalize(tradingsymbol);
  if (!wantedExchange || !wantedSymbol) return null;

  const matches = master.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const symbol = normalize(
      row.symbol ?? row.tradingsymbol ?? row.SYMBOL ?? row.name
    );
    const segment = normalize(
      row.exchange ?? row.exch_seg ?? row.EXCHANGE
    );
    return segment === wantedExchange &&
      (symbol === wantedSymbol || symbol === `${wantedSymbol}-EQ`);
  });

  if (matches.length !== 1) return null;
  const match = matches[0];
  const token = match.token ?? match.symboltoken ?? match.SymbolToken ?? match.TOKEN;
  return token == null || String(token).trim() === "" ? null : String(token);
}
