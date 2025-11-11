// testPaperTrader.js
import { PaperTrader } from "./papertrading.js";


function nowIso() {
  return new Date().toISOString();
}

(async () => {
  console.log("=== 🧠 PaperTrader Test Start ===");

  const trader = new PaperTrader({
    initialCash: 100000,
    commissionPct: 0.0005,
    slippagePct: 0.0002,
    allowShort: true,
    maxPositionSize: 0.5,
  });
  trader.reset();

  console.log("\n💰 Starting Cash:", trader.cash);

  // 1️⃣ BUY 10 RELIANCE @ 2500
  console.log("\n=== 1. Buying 10 RELIANCE @ ₹2500 ===");
  const buy1 = trader.placeMarketOrder("RELIANCE", "BUY", 10, 2500);
  console.log("Trade executed:", buy1);
  console.log("Current positions:", trader.getPositions());
  console.log("Cash after buy:", trader.cash);

  // 2️⃣ BUY 5 TCS @ 3800
  console.log("\n=== 2. Buying 5 TCS @ ₹3800 ===");
  const buy2 = trader.placeMarketOrder("TCS", "BUY", 5, 3800);
  console.log("Trade executed:", buy2);
  console.log("Current positions:", trader.getPositions());
  console.log("Cash after buy:", trader.cash);

  // 3️⃣ SELL 5 RELIANCE @ 2520
  console.log("\n=== 3. Selling 5 RELIANCE @ ₹2520 ===");
  const sell1 = trader.placeMarketOrder("RELIANCE", "SELL", 5, 2520);
  console.log("Trade executed:", sell1);
  console.log("Current positions:", trader.getPositions());
  console.log("Cash after sell:", trader.cash);

  // 4️⃣ Simulate price movement (tick updates)
  console.log("\n📈 Processing ticks...");
  trader.processTick("RELIANCE", 2530, nowIso());
  trader.processTick("TCS", 3820, nowIso());

  // 5️⃣ Portfolio snapshot
  const snapshot = await trader.getPortfolioSnapshot({
    RELIANCE: 2530,
    TCS: 3820,
  });
  console.log("\n=== 📊 Portfolio Snapshot ===");
  console.log(snapshot);

  // 6️⃣ Performance report
  console.log("\n=== 📈 Performance Metrics ===");
  console.log(trader.getPerformanceMetrics());

  // 7️⃣ Trade history
  console.log("\n=== 🧾 Trade History ===");
  console.log(trader.getTradeHistory());

  console.log("\n=== ✅ PaperTrader Test Complete ===");
})();
