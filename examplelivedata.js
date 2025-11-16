
import { getMarketData, parseTickData } from "./livedataClaude.js";

console.log("🚀 Starting Live Market Data Test...\n");

// Configuration
const SYMBOL = "SBIN-EQ";      // Change this to any symbol you want
const EXCHANGE = "NSE";         // NSE, BSE, NFO, etc.
const MODE = 1;                 // 1=LTP, 2=Quote, 3=Snap Quote
const DURATION = 60000;         // Run for 60 seconds (1 minute)

let tickCount = 0;

// Handler for incoming market data
const handleMarketData = (data) => {
  tickCount++;
  
  console.log(`\n📊 Tick #${tickCount} received at ${new Date().toLocaleTimeString()}`);
  
  // Check if market is closed
  if (data.type === "closed_market") {
    console.log("🔴 Market is CLOSED");
    console.log("Last Traded Data:", JSON.stringify(data.data, null, 2));
    return;
  }
  
  // Market is open - live data
  console.log("🟢 Market is OPEN - Live Data:");
  
  // Parse the tick data
  const parsed = parseTickData(data);
  console.log("Raw data:", data);
  console.log("Parsed data:", parsed);
  
  // Display key information
  if (parsed.ltp) {
    console.log(`💹 Live Price: ₹${parsed.ltp}`);
  }
  if (parsed.token) {
    console.log(`🔖 Token: ${parsed.token}`);
  }
};

// Main execution
async function runTest() {
  try {
    console.log(`📡 Connecting to ${SYMBOL} on ${EXCHANGE}...`);
    console.log(`⏱️  Will run for ${DURATION / 1000} seconds\n`);
    
    // Start getting market data
    const connection = await getMarketData(SYMBOL, EXCHANGE, handleMarketData, MODE);
    
    if (connection.marketClosed) {
      console.log("\n✅ Data fetched (Market Closed)");
      console.log(`Total ticks received: ${tickCount}`);
      process.exit(0);
    }
    
    if (connection.ws) {
      console.log("✅ WebSocket connection established!\n");
      console.log("Receiving live data...\n");
      
      // Auto-disconnect after duration
      setTimeout(() => {
        console.log(`\n\n⏰ ${DURATION / 1000} seconds elapsed. Disconnecting...`);
        connection.disconnect();
        console.log(`\n✅ Test complete!`);
        console.log(`Total ticks received: ${tickCount}`);
        process.exit(0);
      }, DURATION);
    }
    
  } catch (error) {
    console.error("\n❌ Error during test:", error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on('SIGINT', () => {
  console.log('\n\n⚠️  Interrupted by user');
  console.log(`Total ticks received: ${tickCount}`);
  process.exit(0);
});

// Run the test
runTest().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});