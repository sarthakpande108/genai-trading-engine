// connection.js
import { SmartAPI } from "smartapi-javascript";
import speakeasy from "speakeasy";
import { config } from "./config.js";

let globalSession = null;

export async function smartConnect() {
  try {
    if (globalSession && globalSession.accessToken && globalSession.feedToken && globalSession.clientCode) {
      return globalSession;
    }

    const smart_api = new SmartAPI({ api_key: config.apiKey });
    const totp = speakeasy.totp({ secret: config.totpSecret, encoding: "base32" });

    console.log("🔐 Attempting login…");

    // Decide whether to use MPIN or password
    const credential = config.mpin || config.password;
    if (!credential) {
      throw new Error("No mpin or password provided in config");
    }

    const session = await smart_api.generateSession(
      config.clientCode,
      credential,
      totp
    );

    const jwtToken = session?.data?.jwtToken;
    const feedToken = session?.data?.feedToken;
    const clientCode = config.clientCode;

    if (!jwtToken || !feedToken || !clientCode) {
      console.error("❌ Login failed - API did not return required tokens");
      console.log("🔍 Raw Response:", session);
      throw new Error("Invalid session response");
    }

    console.log("✅ Login successful!");

    globalSession = {
      smart_api,
      accessToken: jwtToken,
      feedToken,
      clientCode,
    };
    return globalSession;

  } catch (err) {
    console.error("❌ Login error:", err.message);
    throw err;
  }
}
