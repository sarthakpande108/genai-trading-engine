// testLivePriceFeed.js
import { LivePriceFeed } from "./livedata.js";

(async () => {
  const feed = new LivePriceFeed("RELIANCE-EQ");

  await feed.init();

  feed.onPriceUpdate((symbol, price, source) => {
    console.log(`[${source}] ${symbol}: ₹${price}`);
  });

  // Run for 1 min
  setTimeout(async () => {
    await feed.stop();
    console.log("🛑 Test completed.");
    process.exit(0);
  }, 60000);
})();
