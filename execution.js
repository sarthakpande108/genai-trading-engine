/**
 * Explicit execution boundary.
 * Paper mode is the default and never calls a broker.
 * Live mode requires both an opt-in flag and an injected broker submit function.
 */

import { validateOrderRisk } from "./risk.js";

export function createExecutionAdapter({
  mode = "paper",
  maxOrderNotional,
  availableCapital,
  allowLiveOrders = false,
  submitOrder,
} = {}) {
  if (!["paper", "live"].includes(mode)) throw new RangeError("mode must be paper or live");
  if (!Number.isFinite(maxOrderNotional) || maxOrderNotional <= 0) {
    throw new RangeError("maxOrderNotional must be positive");
  }
  if (!Number.isFinite(availableCapital) || availableCapital <= 0) {
    throw new RangeError("availableCapital must be positive");
  }
  if (mode === "live" && allowLiveOrders !== true) {
    throw new Error("Live orders are disabled. Set allowLiveOrders: true explicitly after independent review.");
  }
  if (mode === "live" && typeof submitOrder !== "function") {
    throw new TypeError("Live mode requires an injected submitOrder function");
  }

  const paperOrders = [];
  return {
    mode,
    getPaperOrders: () => paperOrders.map((order) => ({ ...order })),
    async placeOrder(order) {
      if (!order || !["BUY", "SELL"].includes(order.side) ||
          typeof order.symbol !== "string" || !order.symbol.trim()) {
        throw new TypeError("order must include a symbol and BUY/SELL side");
      }
      const risk = validateOrderRisk({
        side: order.side,
        quantity: order.quantity,
        price: order.price,
        maxOrderNotional,
        availableCapital,
      });
      if (!risk.approved) {
        return { accepted: false, mode, risk, reason: "RISK_CHECK_FAILED" };
      }
      const normalized = {
        symbol: order.symbol.trim().toUpperCase(),
        side: order.side,
        quantity: order.quantity,
        price: order.price,
        productType: order.productType ?? "DELIVERY",
        orderType: order.orderType ?? "LIMIT",
      };
      if (mode === "paper") {
        const paperOrder = {
          ...normalized,
          status: "SIMULATED",
          simulatedAt: new Date().toISOString(),
        };
        paperOrders.push(paperOrder);
        return { accepted: true, mode, order: { ...paperOrder }, risk };
      }
      const brokerResult = await submitOrder(normalized);
      return { accepted: true, mode, order: normalized, brokerResult, risk };
    },
  };
}
