import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.TEST_DATABASE_URL;
const schemaReady = process.env.TEST_PORTFOLIO_SCHEMA_READY === "true";

test("Neon paper portfolio ledger handles fills, cash, cost basis, P&L and snapshots", {
  skip: !databaseUrl || !schemaReady,
}, async () => {
  const previousUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const app = await import("../index.js");
  let portfolio;
  try {
    portfolio = await app.createPaperPortfolio({
      name: "Automated E2E " + randomUUID().slice(0, 8),
      initialCash: 10_000,
    });
    assert.equal(portfolio.cashBalance, 10_000);
    assert.equal(portfolio.status, "ACTIVE");

    const firstBuy = await app.executePaperPortfolioOrder({
      portfolioId: portfolio.id, symbol: "RELIANCE", side: "BUY",
      quantity: 10, price: 100, feeBps: 5,
    });
    assert.equal(firstBuy.accepted, true);
    assert.equal(firstBuy.status, "FILLED");
    assert.equal(firstBuy.fee, 0.5);

    const secondBuy = await app.executePaperPortfolioOrder({
      portfolioId: portfolio.id, symbol: "RELIANCE", side: "BUY",
      quantity: 5, price: 120, feeBps: 5,
    });
    assert.equal(secondBuy.accepted, true);

    const afterBuys = await app.getPaperPortfolioReport(portfolio.id);
    assert.equal(afterBuys.positions.length, 1);
    assert.equal(afterBuys.positions[0].quantity, 15);
    assert.ok(Math.abs(afterBuys.positions[0].averageCost - 106.72) < 1e-8);

    const sell = await app.executePaperPortfolioOrder({
      portfolioId: portfolio.id, symbol: "RELIANCE", side: "SELL",
      quantity: 4, price: 130, feeBps: 5,
    });
    assert.equal(sell.accepted, true);
    assert.ok(Math.abs(sell.realizedPnl - 92.86) < 1e-8);

    const insufficientSell = await app.executePaperPortfolioOrder({
      portfolioId: portfolio.id, symbol: "RELIANCE", side: "SELL",
      quantity: 100, price: 130,
    });
    assert.equal(insufficientSell.accepted, false);
    assert.equal(insufficientSell.reason, "INSUFFICIENT_POSITION");

    const insufficientBuy = await app.executePaperPortfolioOrder({
      portfolioId: portfolio.id, symbol: "TCS", side: "BUY",
      quantity: 1_000, price: 100,
    });
    assert.equal(insufficientBuy.accepted, false);
    assert.equal(insufficientBuy.reason, "INSUFFICIENT_CASH");

    const snapshot = await app.markPaperPortfolio({
      portfolioId: portfolio.id,
      prices: { RELIANCE: 125 },
    });
    assert.ok(Math.abs(snapshot.marketValue - 1_375) < 1e-8);
    assert.ok(Math.abs(snapshot.unrealizedPnl - 201.08) < 1e-8);
    assert.ok(Math.abs(snapshot.equity - 10_293.94) < 1e-8);

    const report = await app.getPaperPortfolioReport(portfolio.id);
    assert.equal(report.orders.length, 5);
    assert.equal(report.trades.length, 3);
    assert.equal(report.metrics.sellFills, 1);
    assert.equal(report.metrics.profitableSellFillRate, 1);
    assert.ok(Math.abs(report.metrics.totalReturn - 0.029394) < 1e-8);
    assert.equal(report.snapshots.length, 1);
    assert.equal(report.positions[0].quantity, 11);
  } finally {
    if (portfolio?.id) {
      await app.queryDatabase("DELETE FROM paper_portfolios WHERE id=$1", [portfolio.id]);
    }
    await app.closeDatabase();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
  }
});
