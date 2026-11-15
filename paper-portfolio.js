import { randomUUID } from "node:crypto";
import { query, withTransaction } from "./db.js";

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(name + " must be positive and finite");
}
function nonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(name + " must be non-negative and finite");
}
function numeric(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) =>
    [key, value !== null && ["number", "string"].includes(typeof value) && /^-?\d+(\.\d+)?$/.test(String(value)) ? Number(value) : value]
  ));
}

export async function createPaperPortfolio({ name, initialCash = 100_000, baseCurrency = "INR" } = {}) {
  if (typeof name !== "string" || !name.trim()) throw new TypeError("portfolio name is required");
  positive(initialCash, "initialCash");
  if (typeof baseCurrency !== "string" || !/^[A-Z]{3}$/.test(baseCurrency)) {
    throw new TypeError("baseCurrency must be a three-letter uppercase currency code");
  }
  const id = randomUUID();
  const { rows } = await query(
    `INSERT INTO paper_portfolios (id,name,base_currency,initial_cash,cash_balance)
     VALUES ($1,$2,$3,$4,$4)
     RETURNING id,name,base_currency AS "baseCurrency",initial_cash AS "initialCash",
       cash_balance AS "cashBalance",realized_pnl AS "realizedPnl",status,created_at AS "createdAt"`,
    [id, name.trim(), baseCurrency, initialCash]
  );
  return numeric(rows[0]);
}

export async function getPaperPortfolio(portfolioId) {
  const { rows } = await query(
    `SELECT id,name,base_currency AS "baseCurrency",initial_cash AS "initialCash",
      cash_balance AS "cashBalance",realized_pnl AS "realizedPnl",status,
      created_at AS "createdAt",updated_at AS "updatedAt"
     FROM paper_portfolios WHERE id=$1`,
    [portfolioId]
  );
  return numeric(rows[0]);
}

/** Simulate a market fill. Cash, order, trade and position changes commit atomically. */
export async function executePaperPortfolioOrder({
  portfolioId, symbol, side, quantity, price, feeBps = 5, metadata = {},
} = {}) {
  if (typeof portfolioId !== "string" || !portfolioId) throw new TypeError("portfolioId is required");
  if (typeof symbol !== "string" || !symbol.trim()) throw new TypeError("symbol is required");
  if (!["BUY", "SELL"].includes(side)) throw new TypeError("side must be BUY or SELL");
  positive(quantity, "quantity");
  positive(price, "price");
  nonNegative(feeBps, "feeBps");
  const normalizedSymbol = symbol.trim().toUpperCase();
  const orderId = randomUUID();
  return withTransaction(async (client) => {
    const portfolioResult = await client.query(
      "SELECT * FROM paper_portfolios WHERE id=$1 FOR UPDATE", [portfolioId]
    );
    const portfolio = portfolioResult.rows[0];
    if (!portfolio) throw new Error("Paper portfolio not found");
    if (portfolio.status !== "ACTIVE") throw new Error("Paper portfolio is not active");

    const fee = quantity * price * feeBps / 10_000;
    const notional = quantity * price;
    let rejectionReason = null;
    let position = null;
    if (side === "BUY" && notional + fee > Number(portfolio.cash_balance)) {
      rejectionReason = "INSUFFICIENT_CASH";
    }
    if (side === "SELL") {
      const positionResult = await client.query(
        "SELECT * FROM paper_portfolio_positions WHERE portfolio_id=$1 AND symbol=$2 FOR UPDATE",
        [portfolioId, normalizedSymbol]
      );
      position = positionResult.rows[0] || null;
      if (!position || Number(position.quantity) < quantity) rejectionReason = "INSUFFICIENT_POSITION";
    }

    if (rejectionReason) {
      await client.query(
        `INSERT INTO paper_portfolio_orders
         (id,portfolio_id,symbol,side,quantity,status,filled_quantity,fee,rejection_reason,metadata)
         VALUES ($1,$2,$3,$4,$5,'REJECTED',0,0,$6,$7::jsonb)`,
        [orderId, portfolioId, normalizedSymbol, side, quantity, rejectionReason, JSON.stringify(metadata)]
      );
      return { accepted: false, orderId, status: "REJECTED", reason: rejectionReason };
    }

    let realizedPnl = 0;
    if (side === "BUY") {
      const totalCost = notional + fee;
      const oldQty = Number(position?.quantity || 0);
      const oldCost = Number(position?.average_cost || 0);
      const newQty = oldQty + quantity;
      const averageCost = (oldQty * oldCost + totalCost) / newQty;
      await client.query(
        `INSERT INTO paper_portfolio_positions (portfolio_id,symbol,quantity,average_cost,updated_at)
         VALUES ($1,$2,$3,$4,NOW())
         ON CONFLICT (portfolio_id,symbol) DO UPDATE SET
           quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,updated_at=NOW()`,
        [portfolioId, normalizedSymbol, newQty, averageCost]
      );
      await client.query(
        "UPDATE paper_portfolios SET cash_balance=cash_balance-$2,updated_at=NOW() WHERE id=$1",
        [portfolioId, totalCost]
      );
    } else {
      realizedPnl = (price - Number(position.average_cost)) * quantity - fee;
      const remaining = Number(position.quantity) - quantity;
      if (remaining <= 1e-9) {
        await client.query(
          "DELETE FROM paper_portfolio_positions WHERE portfolio_id=$1 AND symbol=$2",
          [portfolioId, normalizedSymbol]
        );
      } else {
        await client.query(
          "UPDATE paper_portfolio_positions SET quantity=$3,updated_at=NOW() WHERE portfolio_id=$1 AND symbol=$2",
          [portfolioId, normalizedSymbol, remaining]
        );
      }
      await client.query(
        "UPDATE paper_portfolios SET cash_balance=cash_balance+$2,realized_pnl=realized_pnl+$3,updated_at=NOW() WHERE id=$1",
        [portfolioId, notional - fee, realizedPnl]
      );
    }

    await client.query(
      `INSERT INTO paper_portfolio_orders
       (id,portfolio_id,symbol,side,quantity,order_type,status,fill_price,filled_quantity,fee,metadata)
       VALUES ($1,$2,$3,$4,$5,'MARKET','FILLED',$6,$5,$7,$8::jsonb)`,
      [orderId, portfolioId, normalizedSymbol, side, quantity, price, fee, JSON.stringify(metadata)]
    );
    await client.query(
      `INSERT INTO paper_portfolio_trades
       (id,portfolio_id,order_id,symbol,side,quantity,price,fee,realized_pnl)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [randomUUID(), portfolioId, orderId, normalizedSymbol, side, quantity, price, fee, realizedPnl]
    );
    return { accepted: true, orderId, status: "FILLED", symbol: normalizedSymbol, side, quantity, price, fee, realizedPnl };
  });
}

/** Persist an equity snapshot. Every open position must have a fresh positive mark price. */
export async function markPaperPortfolio({ portfolioId, prices } = {}) {
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) throw new TypeError("prices map is required");
  return withTransaction(async (client) => {
    const portfolioResult = await client.query(
      "SELECT * FROM paper_portfolios WHERE id=$1 FOR UPDATE", [portfolioId]
    );
    const portfolio = portfolioResult.rows[0];
    if (!portfolio) throw new Error("Paper portfolio not found");
    const { rows: positions } = await client.query(
      "SELECT symbol,quantity,average_cost FROM paper_portfolio_positions WHERE portfolio_id=$1 ORDER BY symbol",
      [portfolioId]
    );
    let marketValue = 0;
    let unrealizedPnl = 0;
    const normalizedPrices = {};
    for (const position of positions) {
      const price = Number(prices[position.symbol]);
      positive(price, "mark price for " + position.symbol);
      const quantity = Number(position.quantity);
      marketValue += quantity * price;
      unrealizedPnl += quantity * (price - Number(position.average_cost));
      normalizedPrices[position.symbol] = price;
    }
    const cash = Number(portfolio.cash_balance);
    const equity = cash + marketValue;
    const snapshotId = randomUUID();
    const { rows } = await client.query(
      `INSERT INTO paper_portfolio_equity_snapshots
       (id,portfolio_id,cash,market_value,equity,unrealized_pnl,realized_pnl,prices)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       RETURNING id,portfolio_id AS "portfolioId",snapshot_at AS "snapshotAt",
         cash,market_value AS "marketValue",equity,unrealized_pnl AS "unrealizedPnl",
         realized_pnl AS "realizedPnl",prices`,
      [snapshotId, portfolioId, cash, marketValue, equity, unrealizedPnl,
        Number(portfolio.realized_pnl), JSON.stringify(normalizedPrices)]
    );
    return numeric(rows[0]);
  });
}

export async function getPaperPortfolioReport(portfolioId) {
  const portfolio = await getPaperPortfolio(portfolioId);
  if (!portfolio) throw new Error("Paper portfolio not found");
  const [positionResult, orderResult, tradeResult, snapshotResult] = await Promise.all([
    query(`SELECT symbol,quantity,average_cost AS "averageCost",updated_at AS "updatedAt"
      FROM paper_portfolio_positions WHERE portfolio_id=$1 ORDER BY symbol`, [portfolioId]),
    query(`SELECT id,symbol,side,quantity,status,fill_price AS "fillPrice",fee,
      rejection_reason AS "rejectionReason",created_at AS "createdAt"
      FROM paper_portfolio_orders WHERE portfolio_id=$1 ORDER BY created_at DESC LIMIT 100`, [portfolioId]),
    query(`SELECT id,symbol,side,quantity,price,fee,realized_pnl AS "realizedPnl",executed_at AS "executedAt"
      FROM paper_portfolio_trades WHERE portfolio_id=$1 ORDER BY executed_at DESC LIMIT 500`, [portfolioId]),
    query(`SELECT snapshot_at AS "snapshotAt",cash,market_value AS "marketValue",equity,
      unrealized_pnl AS "unrealizedPnl",realized_pnl AS "realizedPnl",prices
      FROM paper_portfolio_equity_snapshots WHERE portfolio_id=$1 ORDER BY snapshot_at DESC LIMIT 100`, [portfolioId]),
  ]);
  const positions = positionResult.rows.map(numeric);
  const orders = orderResult.rows.map(numeric);
  const trades = tradeResult.rows.map(numeric);
  const snapshots = snapshotResult.rows.map(numeric).reverse();
  const latest = snapshots.at(-1) || null;
  const wins = trades.filter((trade) => trade.side === "SELL" && trade.realizedPnl > 0).length;
  const closed = trades.filter((trade) => trade.side === "SELL");
  const totalReturn = latest ? latest.equity / portfolio.initialCash - 1 : null;
  let peak = -Infinity, maxDrawdown = 0;
  for (const point of snapshots) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }
  return {
    portfolio,
    positions,
    orders,
    trades,
    snapshots,
    metrics: {
      cash: latest?.cash ?? portfolio.cashBalance,
      marketValue: latest?.marketValue ?? null,
      equity: latest?.equity ?? null,
      realizedPnl: portfolio.realizedPnl,
      unrealizedPnl: latest?.unrealizedPnl ?? null,
      totalReturn,
      maxDrawdown,
      closedTrades: closed.length,
      winRate: closed.length ? wins / closed.length : null,
    },
  };
}
