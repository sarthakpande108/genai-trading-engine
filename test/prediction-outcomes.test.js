import test from "node:test";
import assert from "node:assert/strict";
import { buildPredictionOutcomes, classifyReturnDirection } from "../prediction-outcomes.js";

const candle = (day, close) => [
  `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  close, close + 1, close - 1, close, 1000,
];

test("outcomes use sorted unique valid sessions rather than malformed or duplicate rows", () => {
  const rows = [
    candle(4, 103),
    ["not-a-date", 100, 101, 99, 100, 1000],
    candle(1, 100),
    candle(2, 101),
    candle(2, 101),
    candle(3, 102),
    candle(5, Number.NaN),
    ["2026-01-06T00:00:00.000Z", 100, 101, 99, -1, 1000],
  ];
  const outcomes = buildPredictionOutcomes({
    rows, baseTimestamp: candle(1, 100)[0], baseClose: 100,
    outlook: "BULLISH", horizons: [1, 2, 3, 4],
  });

  assert.deepEqual(outcomes.map(({ horizonSessions, actualClose }) => [horizonSessions, actualClose]), [
    [1, 101], [2, 102], [3, 103],
  ]);
  assert.ok(outcomes.every((outcome) => outcome.directionCorrect));
});

test("conflicting duplicate timestamps are excluded instead of shifting horizon prices", () => {
  const outcomes = buildPredictionOutcomes({
    rows: [candle(4, 103), candle(2, 101), candle(1, 100), candle(2, 105), candle(3, 102)],
    baseTimestamp: candle(1, 100)[0], baseClose: 100,
    outlook: "BULLISH", horizons: [1, 2, 3],
  });
  assert.deepEqual(outcomes.map(({ actualClose }) => actualClose), [102, 103]);
  assert.equal(outcomes[0].actualTimestamp, candle(3, 102)[0]);
});

test("an ambiguous base candle prevents scoring instead of selecting a duplicate", () => {
  assert.deepEqual(buildPredictionOutcomes({
    rows: [candle(1, 100), candle(1, 99), candle(2, 101)],
    baseTimestamp: candle(1, 100)[0], baseClose: 100, outlook: "BULLISH",
  }), []);
});

test("direction classification preserves the neutral band boundaries", () => {
  assert.equal(classifyReturnDirection(0.10), "NEUTRAL");
  assert.equal(classifyReturnDirection(-0.10), "NEUTRAL");
  assert.equal(classifyReturnDirection(0.10001), "BULLISH");
  assert.equal(classifyReturnDirection(-0.10001), "BEARISH");
});

test("invalid forecast anchors and horizons fail closed", () => {
  const common = { rows: [candle(1, 100)], baseTimestamp: candle(1, 100)[0], baseClose: 100, outlook: "BULLISH" };
  assert.throws(() => buildPredictionOutcomes({ ...common, baseClose: 0 }), /baseClose/);
  assert.throws(() => buildPredictionOutcomes({ ...common, outlook: "UNKNOWN" }), /outlook/);
  assert.throws(() => buildPredictionOutcomes({ ...common, horizons: [1, 1] }), /horizons/);
  assert.throws(() => buildPredictionOutcomes({ ...common, horizons: [0] }), /horizons/);
});
