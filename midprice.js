import { fetchLast26DaysDailyCandles, fetchLast26FiveMinCandlesRobust } from "./historicaldata.js";

export async function getStockMidPrices(stockName, exchange = "NSE") {
  console.log(`\n📊 Fetching data for: ${stockName} (${exchange}) ...`);

  // Fetch data
  const fiveMinCandles = await fetchLast26FiveMinCandlesRobust(stockName, exchange);
  const dailyCandles = await fetchLast26DaysDailyCandles(stockName, exchange);

  // Helper: compute mid price = (high + low) / 2
  const computeMidPrices = (candles) => {
    if (!Array.isArray(candles) || candles.length === 0) return [];
    return candles.map((c) => ((c[1] + c[2]) / 2).toFixed(2)); // [open, high, low, close, volume]
  };

  // Calculate mid prices
  const fiveMinMidPrices = computeMidPrices(fiveMinCandles);
  const dailyMidPrices = computeMidPrices(dailyCandles);

  console.log(`✅ Got ${fiveMinCandles.length} five-min and ${dailyCandles.length} daily candles.`);
  console.log(`📈 Mid Prices ready for ${stockName}.\n`);

  return {
    stock: stockName,
    fiveMinMidPrices,
    dailyMidPrices,
  };
}

// Example run
{/*}(async () => {
  const tcsData = await getStockMidPrices("TCS", "NSE");
  console.log("TCS 5-min mid prices:", tcsData.fiveMinMidPrices);
  console.log("TCS daily mid prices:", tcsData.dailyMidPrices);

  const relianceData = await getStockMidPrices("RELIANCE", "NSE");
  console.log("Reliance 5-min mid prices:", relianceData.fiveMinMidPrices);
  console.log("Reliance daily mid prices:", relianceData.dailyMidPrices);


  const hdfcData = await getStockMidPrices("HDFCBANK", "NSE");
  console.log("hdfc 5-min mid prices:", hdfcData.fiveMinMidPrices);
  console.log("hdfc daily mid prices:", hdfcData.dailyMidPrices);
})();
*/}