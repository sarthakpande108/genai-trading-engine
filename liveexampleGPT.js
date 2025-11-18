import { startLiveDataWithAutoRefresh } from "./livedataGPT.js";
import dotenv from "dotenv";
dotenv.config();

// 🏦 Set any NSE stock you want!
const symbol = "SBIN-EQ";
const exchange = "NSE";

//console.log(`📢 Testing Live Data for ${symbol} (${exchange})`);

startLiveDataWithAutoRefresh(symbol, exchange, (data) => {
 // console.log("📈 DATA:", data);
}).then((connection) => {
  if (connection.marketClosed) {
    console.log("🔴 MARKET CLOSED → Showing last traded price");
  //  console.log(JSON.stringify(connection.data, null, 2));
  } else {
    console.log("🟢 MARKET OPEN → WebSocket streaming started...");
  }
}).catch(err => {
  console.error("❌ Error:", err.message);
});
