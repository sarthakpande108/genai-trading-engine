// liveData.js
import { SmartAPI, WebSocketV2 } from "smartapi-javascript";
import { smartConnect } from "./main.js";
import { downloadScripMaster, findSymbolToken } from "./utlis.js";

/**
 * 📡 Check if market is currently open (IST)
 * Regular equity session: Mon–Fri, 09:15–15:30 IST
 */
function isMarketOpen() {
  const offsetMs = 330 * 60 * 1000; // 5h30m IST offset from UTC
  const nowUtcMs = Date.now();
  const nowIstMs = nowUtcMs + offsetMs;
  const istNow = new Date(nowIstMs);

  const istHour = istNow.getUTCHours();
  const istMinute = istNow.getUTCMinutes();
  const istDay = istNow.getUTCDay(); // 0 = Sun, 6 = Sat (in IST due to offset trick)

  const sessionOpenHour = 9, sessionOpenMin = 15;
  const sessionCloseHour = 15, sessionCloseMin = 30;

  const isWeekday = istDay !== 0 && istDay !== 6;

  const afterOpen =
    istHour > sessionOpenHour ||
    (istHour === sessionOpenHour && istMinute >= sessionOpenMin);

  const beforeClose =
    istHour < sessionCloseHour ||
    (istHour === sessionCloseHour && istMinute <= sessionCloseMin);

  return isWeekday && afterOpen && beforeClose;
}

/**
 * 🧩 Helper: format JS Date to SmartAPI candle format in IST
 * Format: "YYYY-MM-DD HH:MM"
 */
function formatToISTString(date) {
  const offsetMs = 330 * 60 * 1000;
  const istMs = date.getTime() + offsetMs;
  const d = new Date(istMs);

  const YYYY = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const DD = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");

  return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
}

/**
 * 📊 Get Market Data (LTP/OHLC/FULL) – used when market is CLOSED
 * Uses official Market Data API: getMarketData(mode, exchangeTokens)
 * @param {string} tradingsymbol - e.g. "SBIN-EQ"
 * @param {string} exchange - e.g. "NSE"
 * @param {"LTP"|"OHLC"|"FULL"} mode
 */
export async function getLastTradedPrice(tradingsymbol, exchange, mode = "LTP") {
  try {
    const sessionData = await smartConnect();
    if (!sessionData) throw new Error("Login failed");

    const { smart_api } = sessionData;
    const master = await downloadScripMaster();
    const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
    if (!token) throw new Error(`Token not found for ${tradingsymbol}`);

    const symboltoken = String(token);
    const exchangeTokens = { [exchange]: [symboltoken] };

    const response = await smart_api.getMarketData(mode, exchangeTokens);

    if (response?.data) {
      const firstKey = Object.keys(response.data)[0];
      const info = response.data[firstKey];

      // 🎯 Use LTP if available
      if (info?.ltp) {
        return Number(info.ltp);
      }
    }

    throw new Error("Invalid getMarketData result");
  } catch (err) {
    console.warn("⚠️ Primary LTP fetch failed → Fallback", err.message);

    // Fallback using candle close price
    try {
      const sessionData = await smartConnect();
      const { smart_api } = sessionData;
      const master = await downloadScripMaster();
      const token = findSymbolToken(master, exchange, tradingsymbol);
      const symboltoken = String(token);

      const now = new Date();
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - 3);

      const resp = await smart_api.getCandleData({
        exchange,
        symboltoken,
        interval: "ONE_DAY",
        fromdate: formatToISTString(fromDate),
        todate: formatToISTString(now),
      });

      if (Array.isArray(resp?.data) && resp.data.length > 0) {
        const last = resp.data[resp.data.length - 1];
        const closePrice = Number(last[4]); // index 4 = closing price
        return closePrice;
      }

      return null;
    } catch (fallbackErr) {
      console.error("❌ Fallback failed:", fallbackErr.message);
      return null;
    }
  }
}


/**
 * 🔴 Stream live market data using WebSocket V2
 * @param {string} tradingsymbol - Trading symbol (e.g., "SBIN-EQ")
 * @param {string} exchange - Exchange name (e.g., "NSE")
 * @param {function} onTickCallback - Callback function to handle live tick data
 * @param {number} mode - 1=LTP, 2=Quote, 3=Snap Quote (Depth)
 * @returns {Promise<object>} WebSocket connection object with disconnect & unsubscribe
 *
 * NOTE (from Angel One forum):
 * feedtype MUST be the FEED TOKEN, not "order_feed" etc. :contentReference[oaicite:4]{index=4}
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

    // smartConnect() should give you:
    // { smart_api, accessToken: jwtToken, feedToken, clientCode }
    const { smart_api, accessToken, feedToken, clientCode } = sessionData;

    // Get symbol token
    const master = await downloadScripMaster();
    const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;

    if (!token) {
      throw new Error(`Symbol token not found for ${tradingsymbol} on ${exchange}`);
    }

    const symboltoken = String(token);

    // Exchange type mapping (as per SmartAPI docs)
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

    console.log(`🔴 Starting WebSocketV2 for ${tradingsymbol} (Token: ${symboltoken})`);

    // ✅ WebSocketV2 requires feedtype = FEED TOKEN (x-feed-token header)
    const ws = new WebSocketV2({
      jwttoken: accessToken,
      apikey: smart_api.api_key,
      clientcode: clientCode || smart_api.client_code,
      feedtype: feedToken, // 👈 NOT "order_feed"
    });

    // Connection promise
    const connectionPromise = new Promise((resolve, reject) => {
      let resolved = false;

      ws.on("connect", () => {
        console.log("✅ WebSocketV2 Connected");

        const subscriptionPayload = {
          correlationID: `${tradingsymbol}_${Date.now()}`,
          action: 1, // 1 = subscribe, 0 = unsubscribe
          mode, // 1=LTP, 2=Quote, 3=SnapQuote (Depth)
          exchangeType,
          tokens: [symboltoken],
        };

        ws.fetchData(subscriptionPayload);
        console.log(`📡 Subscribed to ${tradingsymbol} in mode ${mode}`);

        if (!resolved) {
          resolved = true;
          resolve(ws);
        }
      });

      ws.on("tick", (data) => {
        if (onTickCallback && typeof onTickCallback === "function") {
          onTickCallback(data);
        }
      });

      ws.on("error", (error) => {
        console.error("❌ WebSocketV2 Error:", error);
        if (!resolved) {
          resolved = true;
          reject(error);
        }
      });

      ws.on("close", () => {
        console.log("🔌 WebSocketV2 Disconnected");
      });

      // Safety: timeout if connection doesn't happen
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("WebSocketV2 connection timeout"));
        }
      }, 10000);
    });

    // Connect + wait for resolve
    await ws.connect();
    const connection = await connectionPromise;

    return {
      ws: connection,
      disconnect: () => {
        console.log("🛑 Closing WebSocketV2 connection...");
        connection.close();
      },
      unsubscribe: (tokens) => {
        const unsubscribePayload = {
          correlationID: `unsub_${Date.now()}`,
          action: 0, // unsubscribe
          mode,
          exchangeType,
          tokens: tokens || [symboltoken],
        };
        connection.fetchData(unsubscribePayload);
        console.log(`📴 Unsubscribed from tokens:`, tokens || [symboltoken]);
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
export async function getMarketData(
  tradingsymbol,
  exchange,
  onTickCallback,
  mode = 1
) {
  const marketOpen = isMarketOpen();

  if (marketOpen) {
    console.log("🟢 Market is OPEN - Starting live WebSocket stream...");
    return await streamLiveMarketData(tradingsymbol, exchange, onTickCallback, mode);
  } else {
    console.log("🔴 Market is CLOSED - Fetching last traded price via REST APIs...");
    const marketDataMode = mode === 1 ? "LTP" : mode === 2 ? "OHLC" : "FULL";
    const ltpData = await getLastTradedPrice(tradingsymbol, exchange, marketDataMode);

    if (onTickCallback && ltpData) {
      onTickCallback({
        type: "closed_market",
        data: ltpData,
        message: "Market is closed. Showing last traded price / last candle.",
      });
    }

    return { marketClosed: true, data: ltpData };
  }
}

/**
 * 🎨 Parse WebSocket tick data (basic)
 * NOTE: Exact fields depend on WebSocketV2 depth/mode format
 */
export function parseTickData(data, mode = 1) {
  try {
    if (!data || typeof data !== "object") return data;

    // Try common field names
    const ltpRaw = data.ltp ?? data.last_traded_price ?? data.lastTradedPrice;

    if (ltpRaw !== undefined) {
      return {
        ...data,
        ltp: Number(ltpRaw) / 100, // price often in paise
        token: data.token || data.symboltoken,
        timestamp: data.exchange_timestamp || data.timestamp || Date.now(),
      };
    }

    return data;
  } catch (err) {
    console.error("Error parsing tick data:", err);
    return data;
  }
}

/**
 * 📺 Example usage with automatic market-close disconnect
 */
export async function startLiveDataWithAutoRefresh(
  tradingsymbol,
  exchange,
  refreshCallback
) {
  let connection = null;

  const dataHandler = (tick) => {
    const parsed = parseTickData(tick);
    console.log(`💹 Live Update:`, parsed);

    if (refreshCallback) {
      refreshCallback(parsed);
    }
  };

  // Initial connection (live or closed-market)
  connection = await getMarketData(tradingsymbol, exchange, dataHandler, 1);

  // If market is open, monitor for close & disconnect
  if (!connection.marketClosed) {
    const checkInterval = setInterval(() => {
      if (!isMarketOpen() && connection && connection.disconnect) {
        console.log("⏰ Market has closed. Disconnecting WebSocketV2...");
        connection.disconnect();
        clearInterval(checkInterval);
      }
    }, 60_000); // every minute

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

    const { smart_api, accessToken, feedToken, clientCode } = sessionData;
    const master = await downloadScripMaster();

    const tokensByExchangeType = {};

    const exchangeTypeMap = {
      NSE: 1,
      NFO: 2,
      BSE: 3,
      BFO: 4,
      MCX: 5,
      NCDEX: 7,
      CDS: 13,
    };

    for (const { tradingsymbol, exchange } of symbols) {
      const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
      if (!token) {
        console.warn(
          `Skipping ${tradingsymbol} on ${exchange} – token not found in master`
        );
        continue;
      }

      const exchangeType = exchangeTypeMap[exchange] || 1;

      if (!tokensByExchangeType[exchangeType]) {
        tokensByExchangeType[exchangeType] = [];
      }
      tokensByExchangeType[exchangeType].push(String(token));
    }

    console.log("🔴 Starting Multi-Symbol WebSocketV2");

    const ws = new WebSocketV2({
      jwttoken: accessToken,
      apikey: smart_api.api_key,
      clientcode: clientCode || smart_api.client_code,
      feedtype: feedToken, // FEED TOKEN here as well
    });

    await ws.connect();

    ws.on("connect", () => {
      console.log("✅ Multi-Symbol WebSocketV2 Connected");

      for (const [exchangeType, tokens] of Object.entries(tokensByExchangeType)) {
        const subscriptionPayload = {
          correlationID: `multi_${Date.now()}_${exchangeType}`,
          action: 1,
          mode,
          exchangeType: parseInt(exchangeType, 10),
          tokens,
        };
        ws.fetchData(subscriptionPayload);
        console.log(
          `📡 Subscribed to ${tokens.length} tokens on exchangeType ${exchangeType}`
        );
      }
    });

    ws.on("tick", onTickCallback);

    ws.on("error", (error) => {
      console.error("❌ Multi-Symbol WebSocketV2 Error:", error);
    });

    ws.on("close", () => {
      console.log("🔌 Multi-Symbol WebSocketV2 Disconnected");
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



