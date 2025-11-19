// liveexamplestreaming.js
import { startLiveStream } from "./livedata.js";
import { downloadScripMaster, findSymbolToken } from "./utlis.js";

const symbol = "RELIANCE-EQ"; // ⭐ TEST RELIANCE
const exchange = "NSE";

(async () => {
  try {
    console.log("⬇️ Loading local scrip master...");
    const master = await downloadScripMaster();
    if (!master) throw new Error("Failed to load master");

    const token = findSymbolToken(master, exchange, symbol);
    if (!token) throw new Error(`No token found for ${symbol}`);

    console.log(`🎯 Token for ${symbol}: ${token}`);

    await startLiveStream(token, exchange, (tick) => {
      console.log("📨 RAW TICK:", tick);

      const ltpRaw =
        tick.ltp ??
        tick.last_traded_price ??
        tick.LastTradedPrice ??
        tick.LTPrice;

      if (ltpRaw !== undefined) {
        const price = Number(ltpRaw) / 100; // many feeds return paise
        console.log(`💹 ${symbol} Live Price: ₹${price}`);
      }
    }, 3); // ⭐ Try mode=2 (Market Quote Mode)
  } catch (err) {
    console.error("❌ ERROR:", err.message);
  }
})();
