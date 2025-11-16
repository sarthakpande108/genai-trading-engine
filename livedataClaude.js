// liveData.js
import { SmartAPI, WebSocketV2 } from "smartapi-javascript";
import { smartConnect } from "./main.js";
import { downloadScripMaster, findSymbolToken } from "./utlis.js";

/**
 * 📡 Check if market is currently open
 */
function isMarketOpen() {
  const offsetMs = 330 * 60 * 1000; // IST offset
  const nowUtcMs = Date.now();
  const nowIstMs = nowUtcMs + offsetMs;
  const istNow = new Date(nowIstMs);
  
  const istHour = istNow.getUTCHours();
  const istMinute = istNow.getUTCMinutes();
  const istDay = istNow.getUTCDay();
  
  const sessionOpenHour = 9, sessionOpenMin = 15;
  const sessionCloseHour = 15, sessionCloseMin = 30;
  
  const isInSession =
    (istHour > sessionOpenHour || (istHour === sessionOpenHour && istMinute >= sessionOpenMin)) &&
    (istHour < sessionCloseHour || (istHour === sessionCloseHour && istMinute <= sessionCloseMin)) &&
    istDay !== 0 && istDay !== 6;
  
  return isInSession;
}

/**
 * 📊 Get Market Data (LTP/OHLC) when market is closed using new Market Data API
 * @param {string} mode - "LTP", "OHLC", or "FULL"
 */
export async function getLastTradedPrice(tradingsymbol, exchange, mode = "LTP") {
  try {
    const sessionData = await smartConnect();
    if (!sessionData) throw new Error("Login failed");

    const { smart_api } = sessionData;
    const master = await downloadScripMaster();
    const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
    const symboltoken = token || "3045";

    // Use the new Market Data API
    const payload = {
      mode: mode, // "LTP", "OHLC", or "FULL"
      exchangeTokens: {
        [exchange]: [String(symboltoken)]
      }
    };

    const response = await smart_api.getMarketData(mode, { [exchange]: [String(symboltoken)] });

    if (response?.data) {
      console.log(`📊 Market Data for ${tradingsymbol}:`, response.data);
      return response.data;
    }
    
    return null;
  } catch (err) {
    console.error("Error fetching market data:", err.message);
    
    // Fallback: Try to get last candle from historical data
    try {
      console.log("🔄 Trying fallback method with historical data...");
      const sessionData = await smartConnect();
      const { smart_api } = sessionData;
      const master = await downloadScripMaster();
      const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
      const symboltoken = token || "3045";

      const offsetMs = 330 * 60 * 1000;
      const nowUtcMs = Date.now();
      const nowIstMs = nowUtcMs + offsetMs;
      const now = new Date(nowIstMs);

      const formatToIST = (date) => {
        const istMs = date.getTime() + 330 * 60000;
        const d = new Date(istMs);
        const YYYY = d.getUTCFullYear();
        const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
        const DD = String(d.getUTCDate()).padStart(2, "0");
        const hh = String(d.getUTCHours()).padStart(2, "0");
        const mm = String(d.getUTCMinutes()).padStart(2, "0");
        return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
      };

      const toDate = now;
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 5); // Last 5 days

      const resp = await smart_api.getCandleData({
        exchange,
        symboltoken: String(symboltoken),
        interval: "ONE_DAY",
        fromdate: formatToIST(fromDate),
        todate: formatToIST(toDate),
      });

      if (resp?.data?.length > 0) {
        const lastCandle = resp.data[resp.data.length - 1];
        const [timestamp, open, high, low, close, volume] = lastCandle;
        
        console.log(`📊 Last Trading Day Data for ${tradingsymbol}:`);
        console.log(`   Close: ${close}, High: ${high}, Low: ${low}, Volume: ${volume}`);
        
        return {
          fetched: true,
          data: {
            symbolToken: symboltoken,
            tradingSymbol: tradingsymbol,
            exchange: exchange,
            ltp: close,
            open: open,
            high: high,
            low: low,
            close: close,
            volume: volume,
            lastTradedTime: timestamp,
          }
        };
      }
      
      return null;
    } catch (fallbackErr) {
      console.error("Fallback method also failed:", fallbackErr.message);
      return null;
    }
  }
}

/**
 * 🔴 Stream live market data using WebSocket V2
 * @param {string} tradingsymbol - Trading symbol (e.g., "SBIN-EQ")
 * @param {string} exchange - Exchange name (e.g., "NSE")
 * @param {function} onTickCallback - Callback function to handle live tick data
 * @param {number} mode - 1=LTP, 2=Quote, 3=Snap Quote (Full data with depth)
 * @returns {Promise<object>} WebSocket connection object with disconnect method
 */
export async function streamLiveMarketData(
  tradingsymbol,
  exchange,
  onTickCallback,
  mode = 1
) {
  try {
    const sessionData = await smartConnect();
    if (!sessionData) throw new Error("Login failed");

    const { smart_api, accessToken } = sessionData;
    
    // Get symbol token
    const master = await downloadScripMaster();
    const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
    const symboltoken = token || "3045";

    // Exchange type mapping
    const exchangeTypeMap = {
      NSE: 1,
      NFO: 2,
      BSE: 3,
      BFO: 4,
      MCX: 5,
      NCDEX: 7,
      CDS: 13,
    };

    const exchangeType = exchangeTypeMap[exchange] || 1;

    console.log(`🔴 Starting WebSocket for ${tradingsymbol} (Token: ${symboltoken})`);
    
    // Initialize WebSocket V2
    const ws = new WebSocketV2({
      jwttoken: accessToken,
      apikey: smart_api.api_key,
      clientcode: smart_api.client_code,
      feedtype: "order_feed",
    });

    // Connection promise
    const connectionPromise = new Promise((resolve, reject) => {
      let resolved = false;

      ws.on("connect", () => {
        console.log("✅ WebSocket Connected");
        
        // Subscribe to token
        const subscriptionPayload = {
          correlationID: `${tradingsymbol}_${Date.now()}`,
          action: 1, // 1 = subscribe, 0 = unsubscribe
          mode: mode, // 1=LTP, 2=Quote, 3=Snap Quote
          exchangeType: exchangeType,
          tokens: [String(symboltoken)],
        };

        ws.fetchData(subscriptionPayload);
        console.log(`📡 Subscribed to ${tradingsymbol} in mode ${mode}`);
        
        if (!resolved) {
          resolved = true;
          resolve(ws);
        }
      });

      ws.on("tick", (data) => {
        // Parse and pass data to callback
        if (onTickCallback && typeof onTickCallback === "function") {
          onTickCallback(data);
        }
      });

      ws.on("error", (error) => {
        console.error("❌ WebSocket Error:", error);
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });

      ws.on("close", () => {
        console.log("🔌 WebSocket Disconnected");
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("WebSocket connection timeout"));
        }
      }, 10000);
    });

    // Connect
    await ws.connect();
    const connection = await connectionPromise;

    // Return connection object with disconnect method
    return {
      ws: connection,
      disconnect: () => {
        console.log("🛑 Closing WebSocket connection...");
        connection.close();
      },
      unsubscribe: (tokens) => {
        const unsubscribePayload = {
          correlationID: `unsub_${Date.now()}`,
          action: 0, // 0 = unsubscribe
          mode: mode,
          exchangeType: exchangeType,
          tokens: tokens || [String(symboltoken)],
        };
        connection.fetchData(unsubscribePayload);
        console.log(`📴 Unsubscribed from tokens: ${tokens}`);
      },
    };
  } catch (err) {
    console.error("Error in streamLiveMarketData:", err);
    throw err;
  }
}

/**
 * 🎯 Smart function: Get live data if market open, else last traded price
 */
export async function getMarketData(tradingsymbol, exchange, onTickCallback, mode = 1) {
  const marketOpen = isMarketOpen();
  
  if (marketOpen) {
    console.log("🟢 Market is OPEN - Starting live stream...");
    return await streamLiveMarketData(tradingsymbol, exchange, onTickCallback, mode);
  } else {
    console.log("🔴 Market is CLOSED - Fetching last traded price...");
    const marketDataMode = mode === 1 ? "LTP" : mode === 2 ? "OHLC" : "FULL";
    const ltpData = await getLastTradedPrice(tradingsymbol, exchange, marketDataMode);
    
    // Call the callback once with the closed market data
    if (onTickCallback && ltpData) {
      onTickCallback({
        type: "closed_market",
        data: ltpData,
        message: "Market is closed. Showing last traded price.",
      });
    }
    
    return { marketClosed: true, data: ltpData };
  }
}

/**
 * 🎨 Parse WebSocket tick data (binary response)
 * Mode 1 (LTP): { token, ltp }
 * Mode 2 (Quote): { token, ltp, open, high, low, close, volume }
 * Mode 3 (Snap Quote): Full data including depth
 */
export function parseTickData(data, mode = 1) {
  try {
    // WebSocket V2 returns binary data that needs parsing
    // The exact parsing depends on Angel One's binary format
    // Typically returns an object with subscription_mode and fetched data
    
    if (data && data.last_traded_price) {
      return {
        ltp: data.last_traded_price / 100, // Usually price is in paise
        token: data.token,
        timestamp: data.exchange_timestamp || Date.now(),
      };
    }
    
    return data;
  } catch (err) {
    console.error("Error parsing tick data:", err);
    return data;
  }
}

/**
 * 📺 Example usage with automatic refresh
 */
export async function startLiveDataWithAutoRefresh(tradingsymbol, exchange, refreshCallback) {
  let connection = null;
  
  const dataHandler = (tick) => {
    const parsed = parseTickData(tick);
    console.log(`💹 Live Update:`, parsed);
    
    if (refreshCallback) {
      refreshCallback(parsed);
    }
  };
  
  // Initial connection
  connection = await getMarketData(tradingsymbol, exchange, dataHandler, 1);
  
  // If market is open, set up periodic market status check
  if (!connection.marketClosed) {
    const checkInterval = setInterval(() => {
      if (!isMarketOpen() && connection && connection.disconnect) {
        console.log("⏰ Market has closed. Disconnecting WebSocket...");
        connection.disconnect();
        clearInterval(checkInterval);
      }
    }, 60000); // Check every minute
    
    return {
      ...connection,
      stopMonitoring: () => {
        clearInterval(checkInterval);
        if (connection && connection.disconnect) {
          connection.disconnect();
        }
      },
    };
  }
  
  return connection;
}

/**
 * 📊 Multi-token streaming (subscribe to multiple symbols)
 */
export async function streamMultipleSymbols(symbols, onTickCallback, mode = 1) {
  try {
    const sessionData = await smartConnect();
    if (!sessionData) throw new Error("Login failed");

    const { smart_api, accessToken } = sessionData;
    const master = await downloadScripMaster();

    // Get all tokens
    const tokensByExchange = {};
    
    for (const { tradingsymbol, exchange } of symbols) {
      const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
      const exchangeTypeMap = { NSE: 1, NFO: 2, BSE: 3, BFO: 4, MCX: 5, NCDEX: 7, CDS: 13 };
      const exchangeType = exchangeTypeMap[exchange] || 1;
      
      if (!tokensByExchange[exchangeType]) {
        tokensByExchange[exchangeType] = [];
      }
      tokensByExchange[exchangeType].push(String(token || "3045"));
    }

    console.log("🔴 Starting Multi-Symbol WebSocket");

    const ws = new WebSocketV2({
      jwttoken: accessToken,
      apikey: smart_api.api_key,
      clientcode: smart_api.client_code,
      feedtype: "order_feed",
    });

    await ws.connect();

    ws.on("connect", () => {
      console.log("✅ Multi-Symbol WebSocket Connected");
      
      // Subscribe to all exchange types
      for (const [exchangeType, tokens] of Object.entries(tokensByExchange)) {
        const subscriptionPayload = {
          correlationID: `multi_${Date.now()}`,
          action: 1,
          mode: mode,
          exchangeType: parseInt(exchangeType),
          tokens: tokens,
        };
        ws.fetchData(subscriptionPayload);
        console.log(`📡 Subscribed to ${tokens.length} tokens on exchange ${exchangeType}`);
      }
    });

    ws.on("tick", onTickCallback);

    ws.on("error", (error) => {
      console.error("❌ Multi-Symbol WebSocket Error:", error);
    });

    ws.on("close", () => {
      console.log("🔌 Multi-Symbol WebSocket Disconnected");
    });

    return {
      ws,
      disconnect: () => ws.close(),
    };
  } catch (err) {
    console.error("Error in streamMultipleSymbols:", err);
    throw err;
  }
}