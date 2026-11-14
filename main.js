import { SmartAPI } from "smartapi-javascript";
import speakeasy from "speakeasy";

let cachedSession = null;
let loginInFlight = null;

function readCredentials(overrides = {}) {
  const credentials = {
    apiKey: overrides.apiKey ?? process.env.ANGEL_API_KEY,
    clientCode: overrides.clientCode ?? process.env.ANGEL_CLIENT_CODE,
    mpin: overrides.mpin ?? process.env.ANGEL_MPIN,
    totpSecret: overrides.totpSecret ?? process.env.ANGEL_TOTP_SECRET,
  };
  const missing = Object.entries(credentials)
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Missing Angel One credentials: ${missing.join(", ")}`);
  }
  return credentials;
}

/**
 * Create or reuse an Angel One SmartAPI session.
 * Credentials are read at call time, never imported from a committed config file.
 * Concurrent callers share one login attempt.
 */
export async function smartConnect({ credentials: overrides, forceRefresh = false } = {}) {
  if (!forceRefresh && cachedSession?.accessToken) return cachedSession;
  if (loginInFlight) return loginInFlight;

  loginInFlight = (async () => {
    const credentials = readCredentials(overrides);
    const smart_api = new SmartAPI({ api_key: credentials.apiKey });
    const otp = speakeasy.totp({
      secret: credentials.totpSecret,
      encoding: "base32",
    });

    const response = await smart_api.generateSession(
      credentials.clientCode,
      credentials.mpin,
      otp
    );
    const data = response?.data;
    if (!data?.jwtToken || !data?.feedToken) {
      throw new Error("SmartAPI returned an incomplete session response");
    }

    cachedSession = {
      smart_api,
      accessToken: data.jwtToken,
      feedToken: data.feedToken,
      clientCode: credentials.clientCode,
    };
    return cachedSession;
  })();

  try {
    return await loginInFlight;
  } catch (error) {
    cachedSession = null;
    throw error;
  } finally {
    loginInFlight = null;
  }
}

/** Clear the in-memory session, e.g. after an authentication failure. */
export function clearSmartSession() {
  cachedSession = null;
}
