// testPaperTrader_LiveOnce.js
import dotenv from "dotenv";
dotenv.config();

import { PaperTrader } from "./papertrading.js";
import { getLastTradedPrice } from "./livedataGPT.js";

import chalk from "chalk";
import Table from "cli-table3";

function nowIso() { return new Date().toISOString(); }

function renderTerminalDashboard(trader, priceMap) {
  if (!trader || !priceMap || Object.keys(priceMap).length === 0) return;
  const positions = trader.getPositions();
  if (!positions || Object.keys(positions).length === 0) return;

  console.clear();
  console.log(chalk.bold.blue("📊 REAL-TIME PAPER TRADING DASHBOARD\n"));

  let unrealTotal = 0;

  const table = new Table({
    head: ["Symbol", "Qty", "Avg Price", "LTP", "Unrealized P&L", "Side"],
    style: { head: ['yellow'] },
  });

  Object.keys(positions).forEach(symbol => {
    const pos = positions[symbol];
    const price = priceMap[symbol];
    if (!price) return;

    const pnl = (price - pos.avgPrice) * pos.qty;
    unrealTotal += pnl;

    table.push([
      symbol,
      pos.qty,
      "₹" + pos.avgPrice.toFixed(2),
      "₹" + price.toFixed(2),
      pnl >= 0 ? chalk.green("₹" + pnl.toFixed(2)) : chalk.red("₹" + pnl.toFixed(2)),
      pos.side
    ]);
  });

  console.log(table.toString());
  console.log(
    `\n💰 Cash: ${chalk.cyan("₹" + trader.cash.toFixed(2))} | ` +
    `📈 Equity: ${chalk.green("₹" + (trader.cash + unrealTotal).toFixed(2))}`
  );

  console.log(`⏱ Updated: ${new Date().toLocaleTimeString()}`);
}

(async () => {
  console.log("=== 🧠 PaperTrader LIVE Test Start ===");

  const trader = new PaperTrader({
    initialCash: 100000,
    commissionPct: 0.0005,
    slippagePct: 0.0002,
    allowShort: true,
    maxPositionSize: 0.5,
  });
  trader.reset();
  console.log("\n💰 Starting Cash:", trader.cash);

  const REL_PRICE = await getLastTradedPrice("RELIANCE-EQ", "NSE");
  const TCS_PRICE = await getLastTradedPrice("TCS-EQ", "NSE");
  if (!REL_PRICE || !TCS_PRICE) return console.log("❌ Live price failed");

  console.log("\nLIVE Prices:");
  console.log(`RELIANCE ₹${REL_PRICE}`);
  console.log(`TCS ₹${TCS_PRICE}`);

  console.log(`\n=== 1. Buying 10 RELIANCE @ ₹${REL_PRICE} ===`);
  trader.placeMarketOrder("RELIANCE", "BUY", 25, 1510);

  console.log(`\n=== 2. Buying 5 TCS @ ₹${TCS_PRICE} ===`);
  trader.placeMarketOrder("TCS", "BUY", 10, 3100);

  const REL_PRICE2 = await getLastTradedPrice("RELIANCE-EQ", "NSE");
  console.log(`\n=== 3. Selling 5 RELIANCE @ ₹${REL_PRICE2} ===`);
  trader.placeMarketOrder("RELIANCE", "SELL", 5, REL_PRICE2);

  trader.processTick("RELIANCE", REL_PRICE2, nowIso());
  trader.processTick("TCS", TCS_PRICE, nowIso());

  // 🟦 NOW PROPER DASHBOARD CALL
  renderTerminalDashboard(trader, {
    RELIANCE: REL_PRICE2,
    TCS: TCS_PRICE
  });

  console.log("\n=== 🧾 Trade History ===");
  console.log(trader.getTradeHistory());

  console.log("\n=== 📈 Metrics ===");
  console.log(trader.getPerformanceMetrics());

  console.log("\n=== ✅ PaperTrader LIVE Test Complete ===");
})();
