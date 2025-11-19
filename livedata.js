// livedata.js
import { WebSocketV2 } from "smartapi-javascript";
import { smartConnect } from "./main.js";

const exchangeTypeMap = {
  NSE: 1, NFO: 2, BSE: 3, BFO: 4, MCX: 5, NCDEX: 7, CDS: 13,
};

export async function startLiveStream(token, exchange, onTick, mode = 3) {
  const session = await smartConnect();
  if (!session) throw new Error("Login failed");

  const { smart_api, accessToken, clientCode } = session;
  const exchangeType = exchangeTypeMap[exchange];

  console.log(`🚀 Streaming → ${exchange}:${token}`);

  const ws = new WebSocketV2({
    jwttoken: accessToken,
    apikey: smart_api.api_key,
    clientcode: clientCode, // ✔ MUST BE uppercase code
    feedtype: "marketdata", // ✔ FIXED 🚀
  });

  ws.connect().then(() => {
    const json_req = {
      correlationID: `${token}_${Date.now()}`,
      action: 1,
      mode, // 1=LTP, 2=Quote, 3=SnapQuote(Depth)
      exchangeType,
      tokens: [String(token)],
    };

    console.log("📡 Subscribing:", json_req);

    ws.fetchData(json_req);
  });

  ws.on("tick", (data) => onTick(data));
  ws.on("error", console.error);
  ws.on("close", () => console.log("🔌 Closed"));

  return ws;
}
