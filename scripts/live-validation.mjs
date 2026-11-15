import { analyzeStock, closeDatabase, clearSmartSession } from "../index.js";

const defaults = ["RELIANCE", "TCS", "INFY", "HDFCBANK"];
const symbols = (process.env.VALIDATION_SYMBOLS || defaults.join(","))
  .split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
if (symbols.length === 0 || symbols.length > 4 || new Set(symbols).size !== symbols.length) {
  throw new Error("Provide between 1 and 4 unique NSE symbols.");
}
if (symbols.some((symbol) => !/^[A-Z0-9&-]{1,30}$/.test(symbol))) {
  throw new Error("Symbols must contain only uppercase letters, digits, &, or hyphens.");
}

const companies = {
  RELIANCE: "Reliance Industries",
  TCS: "Tata Consultancy Services",
  INFY: "Infosys",
  HDFCBANK: "HDFC Bank",
};

if (!process.env.ANGEL_API_KEY || !process.env.ANGEL_CLIENT_CODE ||
    !process.env.ANGEL_MPIN || !process.env.ANGEL_TOTP_SECRET) {
  throw new Error("Live validation requires ANGEL_API_KEY, ANGEL_CLIENT_CODE, ANGEL_MPIN and ANGEL_TOTP_SECRET.");
}
if (!process.env.GEMINI_API_KEY) throw new Error("Live validation requires GEMINI_API_KEY.");
if (!process.env.DATABASE_URL) throw new Error("Live validation requires DATABASE_URL.");

const results = [];
try {
  for (const symbol of symbols) {
    const startedAt = Date.now();
    try {
      const result = await analyzeStock({
        symbol,
        exchange: "NSE",
        companyName: companies[symbol] || symbol,
        strictMarketData: true,
        trackPrediction: true,
      });
      const daily = result.input.daily;
      const intraday = result.input.intraday5m;
      if (daily.candleCount < 20 || intraday.candleCount < 20) {
        throw new Error("Insufficient candle history: daily=" + daily.candleCount +
          ", intraday=" + intraday.candleCount);
      }
      if (!result.prediction?.id) throw new Error("Forecast was not persisted to PostgreSQL");
      if (!["BULLISH", "BEARISH", "NEUTRAL"].includes(result.analysis?.outlook)) {
        throw new Error("Gemini returned an unsupported outlook");
      }
      if (!Number.isFinite(result.analysis?.directionalProbabilityPct)) {
        throw new Error("Gemini returned an invalid directional probability");
      }
      const summary = {
        symbol,
        status: "passed",
        dailyCandles: daily.candleCount,
        intradayCandles: intraday.candleCount,
        latestDailyTimestamp: daily.latestTimestamp,
        latestIntradayTimestamp: intraday.latestTimestamp,
        outlook: result.analysis.outlook,
        probabilityPct: result.analysis.directionalProbabilityPct,
        confidence: result.analysis.confidenceLabel,
        geminiModel: result.analysis.model,
        predictionId: result.prediction.id,
        durationMs: Date.now() - startedAt,
        newsStatus: result.input.news?.status || "not-provided",
      };
      results.push(summary);
      console.log(JSON.stringify(summary));
    } catch (error) {
      const failure = { symbol, status: "failed", error: error.message };
      results.push(failure);
      console.error(JSON.stringify(failure));
    }
  }
  const passed = results.filter((item) => item.status === "passed").length;
  console.log(JSON.stringify({ summary: { requested: symbols.length, passed, failed: symbols.length - passed } }));
  if (passed !== symbols.length) process.exitCode = 1;
} finally {
  clearSmartSession();
  await closeDatabase();
}
