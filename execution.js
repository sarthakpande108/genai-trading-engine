/**
 * Explicit execution boundary.
 * Paper mode is the default and never calls a broker.
 * With DATABASE_URL configured, paper orders and positions are persisted atomically.
 * Live mode requires both an opt-in flag and an injected broker submit function.
 */
import { randomUUID } from "node:crypto";
import { validateOrderRisk } from "./risk.js";
import { query, withTransaction } from "./db.js";

export function createExecutionAdapter({
  mode = "paper",
  maxOrderNotional,
  availableCapital,
  allowLiveOrders = false,
  submitOrder,
  persistPaperOrders = Boolean(process.env.DATABASE_URL),
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
  if (persistPaperOrders && mode !== "paper") {
    throw new Error("Paper-order persistence can only be enabled in paper mode");
  }

  const paperOrders = [];
  return {
    mode,
    getPaperOrders: () => paperOrders.map((order) => ({ ...order })),
    async listPaperOrders({ limit = 100 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError("limit must be 1..1000");
      if (!persistPaperOrders) return paperOrders.slice(-limit).reverse();
      const { rows } = await query(
        "SELECT id, symbol, side, quantity, price, product_type AS \"productType\", order_type AS \"orderType\", status, simulated_at AS \"simulatedAt\", metadata FROM paper_orders ORDER BY simulated_at DESC LIMIT $1",
        [limit]
      );
      return rows.map((row) => ({
        ...row,
        quantity: Number(row.quantity),
        price: Number(row.price),
        simulatedAt: new Date(row.simulatedAt).toISOString(),
      }));
    },
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
        id: randomUUID(),
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
        if (persistPaperOrders) {
          await withTransaction(async (client) => {
            if (paperOrder.side === "SELL") {
              const position = await client.query(
                "SELECT quantity FROM paper_positions WHERE symbol = $1 FOR UPDATE",
                [paperOrder.symbol]
              );
              const held = Number(position.rows[0]?.quantity || 0);
              if (held < paperOrder.quantity) {
                const error = new Error("Paper sell quantity exceeds the persisted position");
                error.code = "INSUFFICIENT_PAPER_POSITION";
                throw error;
              }
            }
            await client.query(
              `INSERT INTO paper_orders
                (id, symbol, side, quantity, price, product_type, order_type, status, simulated_at, metadata)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
              [paperOrder.id, paperOrder.symbol, paperOrder.side, paperOrder.quantity,
                paperOrder.price, paperOrder.productType, paperOrder.orderType,
                paperOrder.status, paperOrder.simulatedAt, JSON.stringify(order.metadata || {})]
            );
            if (paperOrder.side === "BUY") {
              await client.query(
                `INSERT INTO paper_positions (symbol, quantity, average_price, updated_at)
                 VALUES ($1,$2,$3,NOW())
                 ON CONFLICT (symbol) DO UPDATE SET
                   average_price = ((paper_positions.quantity * paper_positions.average_price) + (EXCLUDED.quantity * EXCLUDED.average_price)) /
                                   (paper_positions.quantity + EXCLUDED.quantity),
                   quantity = paper_positions.quantity + EXCLUDED.quantity,
                   updated_at = NOW()`,
                [paperOrder.symbol, paperOrder.quantity, paperOrder.price]
              );
            } else {
              await client.query(
                "UPDATE paper_positions SET quantity = quantity - $2, updated_at = NOW() WHERE symbol = $1",
                [paperOrder.symbol, paperOrder.quantity]
              );
              await client.query("DELETE FROM paper_positions WHERE symbol = $1 AND quantity <= 0", [paperOrder.symbol]);
            }
          });
        } else {
          paperOrders.push(paperOrder);
        }
        return { accepted: true, mode, order: { ...paperOrder }, risk, persisted: persistPaperOrders };
      }
      const brokerResult = await submitOrder(normalized);
      return { accepted: true, mode, order: normalized, brokerResult, risk };
    },
  };
}
