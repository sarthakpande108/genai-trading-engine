import { getEma, getRsi, getMacd } from "./indicator.js";
import { getStockMidPrices } from "./midprice.js";

(async () => {
  const { fiveMinMidPrices, dailyMidPrices } = await getStockMidPrices("RELIANCE", "NSE");

  const fiveMin = {
    ema5: getEma(fiveMinMidPrices.map(Number), 5),
    ema20: getEma(fiveMinMidPrices.map(Number), 20),
    rsi14: getRsi(fiveMinMidPrices.map(Number), 14),
    ...getMacd(fiveMinMidPrices.map(Number)),
  };

  console.log("5-min indicators:", fiveMin);


  const daily = {
    ema5: getEma(dailyMidPrices.map(Number), 5),
    ema20: getEma(dailyMidPrices.map(Number), 20),
    rsi14: getRsi(dailyMidPrices.map(Number), 14),
    ...getMacd(dailyMidPrices.map(Number)),
  };

  console.log("daily indicators:", daily);
})();



