// utlis.js
import { promises as fs } from "fs";
import https from "https";

/**
 * Downloads or loads cached Scrip Master file (safe and fast)
 */
export async function downloadScripMaster(cachePath = "./scripMaster.json") {
  try {
    // ✅ Use cache if fresh (< 1 hour)
    try {
      const st = await fs.stat(cachePath);
      const ageMs = Date.now() - st.mtimeMs;
      if (ageMs < 1000 * 60 * 60) {
        const txt = await fs.readFile(cachePath, "utf8");
        return JSON.parse(txt);
      }
    } catch (_) {
      // no cache → download new
    }

    const url =
      "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";

    const data = await new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(
              new Error(`Failed to download master file: ${res.statusCode}`)
            );
            return;
          }
          let raw = "";
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => resolve(raw));
        })
        .on("error", reject);
    });

    await fs.writeFile(cachePath, data, { encoding: "utf8" });
    return JSON.parse(data);
  } catch (err) {
    console.warn("⚠️ Could not download scrip master:", err.message);
    return null;
  }
}

/**
 * ✅ Safe symbol-token finder
 * Handles missing fields and alternate keys in the scrip master JSON
 */
export function findSymbolToken(master, exchange, tradingsymbol) {
  if (!master || !Array.isArray(master)) {
    console.warn("⚠️ Invalid master file input.");
    return null;
  }

  const cleanSymbol = tradingsymbol?.trim().toUpperCase();
  const cleanExchange = exchange?.trim().toUpperCase();
  if (!cleanSymbol || !cleanExchange) {
    console.warn("⚠️ Invalid symbol/exchange provided.");
    return null;
  }

  const match = master.find((row) => {
    if (!row) return false;

    const sym =
      (row.symbol ||
        row.tradingsymbol ||
        row.SYMBOL ||
        row.name ||
        "").toUpperCase();
    const ex =
      (row.exchange ||
        row.exch_seg ||
        row.EXCHANGE ||
        "").toUpperCase();

    // Match logic handles both "TCS" and "TCS-EQ"
    return (
      ex === cleanExchange &&
      (sym === cleanSymbol || sym === `${cleanSymbol}-EQ`)
    );
  });

  if (!match) {
    console.warn(`⚠️ Token not found for ${cleanSymbol} on ${cleanExchange}`);
    return null;
  }

  const token =
    match.token ||
    match.symboltoken ||
    match.SymbolToken ||
    match.TOKEN ||
    null;

  if (!token) {
    console.warn(`⚠️ No token field found for ${cleanSymbol} entry`);
    console.log("Matched entry:", match);
    return null;
  }

  console.log(`✅ Found token for ${cleanSymbol} on ${cleanExchange}: ${token}`);
  return token;
}

/**
 * ✅ Format date to IST in 'YYYY-MM-DD HH:mm'
 */
export function formatToIST(date) {
  const istMs = date.getTime() + 330 * 60000;
  const d = new Date(istMs);
  const YYYY = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const DD = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
}
