/**
 * Risk utilities. All monetary values must use the same currency and units.
 * These helpers calculate limits; they do not submit orders.
 */

function positiveFinite(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

export function calculatePositionSize({
  equity,
  riskFraction = 0.01,
  entryPrice,
  stopPrice,
  maxNotionalFraction = 1,
  lotSize = 1,
}) {
  positiveFinite(equity, "equity");
  positiveFinite(entryPrice, "entryPrice");
  positiveFinite(stopPrice, "stopPrice");
  positiveFinite(riskFraction, "riskFraction");
  positiveFinite(maxNotionalFraction, "maxNotionalFraction");
  positiveFinite(lotSize, "lotSize");
  if (riskFraction > 1 || maxNotionalFraction > 1) {
    throw new RangeError("riskFraction and maxNotionalFraction must be <= 1");
  }
  if (stopPrice >= entryPrice) {
    throw new RangeError("For a long position, stopPrice must be below entryPrice");
  }

  const riskPerUnit = entryPrice - stopPrice;
  const riskBudget = equity * riskFraction;
  const unitsByRisk = Math.floor(riskBudget / riskPerUnit);
  const maxNotional = equity * maxNotionalFraction;
  const unitsByNotional = Math.floor(maxNotional / entryPrice);
  const rawUnits = Math.max(0, Math.min(unitsByRisk, unitsByNotional));
  const quantity = Math.floor(rawUnits / lotSize) * lotSize;

  return {
    quantity,
    estimatedNotional: quantity * entryPrice,
    estimatedLossAtStop: quantity * riskPerUnit,
    riskBudget,
    cappedBy: unitsByRisk <= unitsByNotional ? "risk" : "notional",
  };
}

export function validateOrderRisk({
  side,
  quantity,
  price,
  maxOrderNotional,
  availableCapital,
}) {
  if (!["BUY", "SELL"].includes(side)) throw new TypeError("side must be BUY or SELL");
  positiveFinite(quantity, "quantity");
  positiveFinite(price, "price");
  positiveFinite(maxOrderNotional, "maxOrderNotional");
  positiveFinite(availableCapital, "availableCapital");
  const notional = quantity * price;
  const violations = [];
  if (notional > maxOrderNotional) violations.push("MAX_ORDER_NOTIONAL_EXCEEDED");
  if (side === "BUY" && notional > availableCapital) violations.push("INSUFFICIENT_AVAILABLE_CAPITAL");
  return { approved: violations.length === 0, notional, violations };
}
