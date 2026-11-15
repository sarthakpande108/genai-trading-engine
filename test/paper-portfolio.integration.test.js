import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const schemaReady = process.env.TEST_PORTFOLIO_SCHEMA_READY === "true";

test("Neon cash-account paper portfolio persists fills, fees, positions and equity", {
  skip: !testDatabaseUrl || !schemaReady,
}, async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = testDatabaseUrl;
  let app;
  let portfolioId;
  try {
    app = await import("../index.js");
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    const portfolio = await app.createPaperPortfolio({
      name: "E2E paper portfolio " + suffix, initialCash: 100_000, baseCurrency: "INR",
    });
    portfolioId = portfolio.id;
    assert.equal(portfolio.cashBalance, 100_000);

    const firstBuy = await app.executePaperPortfolioOrder({
      portfolioId, symbol: "reliance", side: "BUY", quantity: 10, price: 100, feeBps: 5,
      metadata: { testRun: suffix },
    });
    assert.equal(firstBuy.accepted, true);
    assert.equal(firstBuy.status, "FILLED");
    assert.equal(firstBuy.fee, 0.5);

    const secondBuy = await app.executePaperPortfolioOrder({
      portfolioId, symbol: "RELIANCE", side: "BUY", quantity: 5, price: 120, feeBps: 5,
      metadata: { testRun: suffix },
    });
    assert.equal(secondBuy.accepted, true);
    assert.ok(Math.abs(secondBuy.fee - 0.3) < 1e-10);

    const firstMark = await app.markPaperPortfolio({ portfolioId, prices: { reliance: 130 } });
    assert.ok(Math.abs(firstMark.marketValue - 1_950) < 1e-8);
    assert.ok(Math.abs(firstMark.equity - 100_349.2) < 1e-8);

    const sell = await app.executePaperPortfolioOrder({
      portfolioId, symbol: "RELIANCE", side: "SELL", quantity: 5, price: 140, feeBps: 5,
      metadata: { testRun: suffix },
    });
    assert.equal(sell.accepted, true);
    assert.ok(Math.abs(sell.realizedPnl - 166.05) < 1e-8);

    const rejectedSell = await app.executePaperPortfolioOrder({
      portfolioId, symbol: "RELIANCE", side: "SELL", quantity: 100, price: 140, feeBps: 5,
      metadata: { testRun: suffix },
    });
    assert.equal(rejectedSell.accepted, false);
    assert.equal(rejectedSell.reason, "INSUFFICIENT_POSITION");

    const rejectedBuy = await app.executePaperPortfolioOrder({
      portfolioId, symbol: "RELIANCE", side: "BUY", quantity: 10_000, price: 140, feeBps: 5,
      metadata: { testRun: suffix },
    });
    assert.equal(rejectedBuy.accepted, false);
    assert.equal(rejectedBuy.reason, "INSUFFICIENT_CASH");

    await assert.rejects(app.markPaperPortfolio({ portfolioId, prices: {} }), /mark price for RELIANCE/);
    const finalMark = await app.markPaperPortfolio({ portfolioId, prices: { RELIANCE: 140 } });
    assert.ok(Math.abs(finalMark.marketValue - 1_400) < 1e-8);
    assert.ok(Math.abs(finalMark.equity - 100_498.85) < 1e-8);

    const report = await app.getPaperPortfolioReport(portfolioId);
    assert.equal(report.positions.length, 1);
    assert.equal(report.positions[0].symbol, "RELIANCE");
    assert.ok(Math.abs(report.positions[0].quantity - 10) < 1e-8);
    assert.ok(Math.abs(report.positions[0].averageCost - 106.72) < 1e-8);
    assert.ok(Math.abs(report.metrics.cash - 99_098.85) < 1e-8);
    assert.equal(report.metrics.closedTrades, 1);
    assert.equal(report.metrics.winRate, 1);
    assert.equal(report.orders.length, 5);
    assert.equal(report.trades.length, 3);
  } finally {
    if (portfolioId && app?.queryDatabase) {
      await app.queryDatabase("DELETE FROM paper_portfolios WHERE id = $1", [portfolioId]).catch(() => {});
    }
    if (app?.closeDatabase) await app.closeDatabase();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
