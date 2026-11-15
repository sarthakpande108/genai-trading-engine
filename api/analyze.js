import { timingSafeEqual } from "node:crypto";
import { analyzeStock, closeDatabase, clearSmartSession } from "../index.js";

export const config = { maxDuration: 60 };

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function authorized(req) {
  const expected = process.env.DEMO_API_KEY;
  const supplied = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "METHOD_NOT_ALLOWED" });
  }
  if (!authorized(req)) return send(res, 401, { error: "UNAUTHORIZED" });
  const symbol = String(req.body?.symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9&-]{1,30}$/.test(symbol)) {
    return send(res, 400, { error: "INVALID_SYMBOL", message: "Provide a valid NSE trading symbol." });
  }
  if (!process.env.GEMINI_API_KEY || !process.env.DATABASE_URL || !process.env.ANGEL_API_KEY ||
      !process.env.ANGEL_CLIENT_CODE || !process.env.ANGEL_MPIN || !process.env.ANGEL_TOTP_SECRET) {
    return send(res, 503, { error: "SERVICE_NOT_CONFIGURED" });
  }
  try {
    const result = await analyzeStock({ symbol, exchange: "NSE", companyName: symbol,
      strictMarketData: true, trackPrediction: true, timeoutMs: 25_000 });
    return send(res, 200, { symbol: result.analysis.symbol, analysis: result.analysis,
      prediction: result.prediction, data: { dailyCandles: result.input.daily.candleCount,
        intradayCandles: result.input.intraday5m.candleCount,
        latestDailyTimestamp: result.input.daily.latestTimestamp,
        latestIntradayTimestamp: result.input.intraday5m.latestTimestamp,
        newsStatus: result.input.news?.status || "not-provided" },
      disclaimer: "Research only. Not investment advice. No order has been placed." });
  } catch (error) {
    const message = error?.message || "Analysis failed";
    const status = /stale|at least 20|chronological|future|invalid candle/i.test(message) ? 422
      : /429|quota|rate.?limit/i.test(message) ? 429 : /timeout|abort/i.test(message) ? 504 : 502;
    return send(res, status, { error: status === 429 ? "MODEL_QUOTA_EXHAUSTED" : "ANALYSIS_FAILED", message });
  } finally {
    clearSmartSession();
    await closeDatabase().catch(() => {});
  }
}