import test from "node:test";
import assert from "node:assert/strict";
import { formatToIST, findSymbolToken } from "../utlis.js";

test("formatToIST formats a UTC instant as IST without host timezone dependence", () => {
  assert.equal(formatToIST(new Date("2026-11-14T00:00:00.000Z")), "2026-11-14 05:30");
});

test("formatToIST rejects invalid dates", () => {
  assert.throws(() => formatToIST(new Date("invalid")), {
    name: "TypeError",
  });
});

test("findSymbolToken resolves exact exchange and symbol", () => {
  const master = [
    { symbol: "TCS-EQ", exch_seg: "NSE", token: "11536" },
    { symbol: "TCS", exch_seg: "BSE", token: "532540" },
  ];
  assert.equal(findSymbolToken(master, "NSE", "TCS"), "11536");
  assert.equal(findSymbolToken(master, "BSE", "TCS"), "532540");
});

test("findSymbolToken never falls back to a different instrument", () => {
  const master = [
    { symbol: "RELIANCE-EQ", exch_seg: "NSE", token: "2885" },
  ];
  assert.equal(findSymbolToken(master, "NSE", "TCS"), null);
});

test("findSymbolToken returns null for ambiguous matches", () => {
  const master = [
    { symbol: "INFY-EQ", exch_seg: "NSE", token: "1" },
    { symbol: "INFY", exch_seg: "NSE", token: "2" },
  ];
  assert.equal(findSymbolToken(master, "NSE", "INFY"), null);
});

test("findSymbolToken validates malformed inputs", () => {
  assert.equal(findSymbolToken(null, "NSE", "TCS"), null);
  assert.equal(findSymbolToken([], "", "TCS"), null);
});
