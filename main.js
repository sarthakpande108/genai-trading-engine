// connection.js
import { SmartAPI } from "smartapi-javascript";
import speakeasy from "speakeasy";
import { config } from "./config.js";

let globalSession = null; // ✅ cache session globally

export const smartConnect = async () => {
  try {
    // ✅ If already logged in and token is valid, reuse it
    if (globalSession && globalSession.accessToken) {
      return globalSession;
    }

    const smart_api = new SmartAPI({ api_key: config.apiKey });

    const totp = speakeasy.totp({
      secret: config.totpSecret,
      encoding: "base32",
    });

    const session = await smart_api.generateSession(
      config.clientCode,
      config.mpin,
      totp
    );

    if (!session || !session.data) {
      console.error("⚠️ Unexpected response structure. Login might have failed partially.");
      return null;
    }

    console.log("✅ Login Successful!");
    config.feedToken = session.data.feedToken;
    config.accessToken = session.data.jwtToken;

    // ✅ Store for reuse
    globalSession = { smart_api, accessToken: session.data.jwtToken };

    return globalSession;
  } catch (error) {
    console.error("❌ Login failed:", error);
    return null;
  }
};

