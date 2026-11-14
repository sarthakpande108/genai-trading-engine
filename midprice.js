import {
  fetchLast20DaysDailyCandles,
  fetchLast20FiveMinCandlesRobust,
} from "./historicaldata.js";

function calculateMidPrices(candles) {
  if (!Array.isArray(candles)) {
    throw new TypeError("candles must be an array");
  }

  return candles.map((candle, index) => {
    if (!Array.isArray(candle) || candle.length < 3) {
      throw new TypeError(`Invalid OHLCV candle at index ${index}`);
    }
    const high = Number(candle[1]);
    const low = Number(candle[2]);
    if (!Number.isFinite(high) || !Number.isFinite(low) || high < low) {
      throw new RangeError(`Invalid high/low values at candle index ${index}`);
    }
    return Number(((high + low) / 2).toFixed(2));
  });
}

/**
 * Fetch daily and intraday candles and derive mid-price series.
 * No network calls occur merely by importing this module.
 */
export async function getStockMidPrices(stockName, exchange = "NSE") {
  if (typeof stockName !== "string" || !stockName.trim()) {
    throw new TypeError("stockName must be a non-empty string");
  }

  const symbol = stockName.trim().toUpperCase();
  const [fiveMinCandles, dailyCandles] = await Promise.all([
    fetchLast20FiveMinCandlesRobust(symbol, exchange),
    fetchLast20DaysDailyCandles(symbol, exchange),
  ]);

  return {
    stock: symbol,
    exchange,
    fiveMinMidPrices: calculateMidPrices(fiveMinCandles),
    dailyMidPrices: calculateMidPrices(dailyCandles),
    candleCounts: {
      fiveMinute: fiveMinCandles.length,
      daily: dailyCandles.length,
    },
  };
}
