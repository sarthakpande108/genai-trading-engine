import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/analyze.js";

function response() { return { statusCode: 200, headers: {}, body: null,
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; } }; }

test("Vercel analysis endpoint rejects non-POST requests", async () => {
  const res = response(); await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405); assert.equal(res.headers.Allow, "POST");
});

test("Vercel analysis endpoint requires a server-side bearer key", async () => {
  const previous = process.env.DEMO_API_KEY; process.env.DEMO_API_KEY = "test-secret";
  try { const res = response(); await handler({ method: "POST", headers: {}, body: { symbol: "RELIANCE" } }, res);
    assert.equal(res.statusCode, 401); assert.equal(res.body.error, "UNAUTHORIZED");
  } finally { if (previous === undefined) delete process.env.DEMO_API_KEY; else process.env.DEMO_API_KEY = previous; }
});

test("Vercel analysis endpoint validates symbols after authentication", async () => {
  const previous = process.env.DEMO_API_KEY; process.env.DEMO_API_KEY = "test-secret";
  try { const res = response(); await handler({ method: "POST",
    headers: { authorization: "Bearer test-secret" }, body: { symbol: "RELIANCE;DROP TABLE" } }, res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.error, "INVALID_SYMBOL");
  } finally { if (previous === undefined) delete process.env.DEMO_API_KEY; else process.env.DEMO_API_KEY = previous; }
});