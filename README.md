# GenAI Trading Engine

A dual-workflow market research and paper-trading project for Indian equities, built with **Node.js, Google Gemini, and Angel One SmartAPI**.

It combines:
- **GenAI market analysis:** Gemini interprets technical indicators, benchmark/sector context and recent news to produce a structured market outlook.
- **Quantitative trading:** deterministic strategies, backtesting, portfolio simulation, risk checks and paper-order simulation.

> **Important:** Gemini currently provides research and forecasts. It does not automatically generate or execute trading orders. The strategy and paper-execution workflow is separate. Paper mode is the default; the current project does not connect the execution adapter to Angel One order placement. This is an experimental project, not investment advice.

---

## How it works

### 1. GenAI market analysis

```mermaid
flowchart TD
    A[Select stock] --> B[Angel One SmartAPI]
    B --> C[Daily + 5-minute candles]
    B --> D[Benchmark / sector data]
    E[NewsAPI] --> F[Recent news articles]
    C --> G[Calculate SMA, EMA, RSI, ATR and volume features]
    D --> H[Market context]
    F --> I[News context]
    G --> J[Combine evidence]
    H --> J
    I --> J
    J --> K[Google Gemini]
    K --> L[Structured market outlook]
    L --> M[Save forecast]
    M --> N[Evaluate after 1, 3 and 5 sessions]
```

The application retrieves and validates the data and calculates indicators. **Gemini is the AI reasoning layer**: it combines the supplied evidence and returns a bullish, bearish or neutral outlook, a 1–5 session horizon, a subjective directional probability estimate, confidence, supporting factors, risks and invalidation conditions.

Forecasts can be stored and later compared with actual prices. `directionalProbabilityPct` means the model-estimated probability that the stated forecast direction is correct: for BULLISH, the probability of a higher price; for BEARISH, the probability of a lower price. Both directional outlooks use a value above 50% and at most 90%; NEUTRAL must be exactly 50%. It is a subjective estimate, not a statistically calibrated probability.

### 2. Quantitative strategy and paper trading

```mermaid
flowchart TD
    A[Historical OHLCV data] --> B[Deterministic strategy]
    B --> C[Long / flat signals]
    C --> D[Backtesting]
    C --> E[Portfolio simulation]
    D --> F[Returns, trades and drawdown]
    E --> F
    G[Proposed order] --> H[Risk validation]
    H --> I{Risk checks pass?}
    I -- No --> J[Reject order]
    I -- Yes --> K[Paper execution]
    K --> L[Simulated order record]
```

This workflow does not depend on Gemini. It uses deterministic SMA-crossover signals, next-bar-open backtesting, cash-account constraints, shared-cash portfolio simulation, fee/slippage assumptions, position sizing and order-risk checks. Single-stock backtests skip buys that exceed available cash; multi-symbol backtests require matching timestamps when timestamps are supplied and process competing entries in alphabetical symbol order. Paper orders are simulated; forecast history is persisted in PostgreSQL. The original paper-order adapter remains available for simple simulations. A separate durable portfolio ledger stores portfolio cash, simulated fills, positions, fees, realized P&L and timestamped equity snapshots in PostgreSQL.

---

## Tech stack

- **Runtime:** Node.js (ES modules)
- **GenAI:** Google Gemini API with structured JSON output
- **Market data:** Angel One SmartAPI
- **News:** NewsAPI (optional)
- **Indicators:** SMA, EMA, RSI, ATR and volume features
- **Trading research:** strategy signals, backtesting and portfolio simulation
- **Risk:** position sizing and order validation
- **Persistence:** Neon PostgreSQL via `pg`, SQL migrations and transactional writes
- **Testing / CI:** Node.js test runner and GitHub Actions

## Quick start

### Requirements

- Node.js 20+
- Angel One SmartAPI credentials
- Gemini API key
- NewsAPI key (optional)

Install and run tests:

```bash
npm ci
npm test
```

Configure these environment variables in your runtime:

```bash
ANGEL_API_KEY=your_angel_api_key
ANGEL_CLIENT_CODE=your_client_code
ANGEL_MPIN=your_mpin
ANGEL_TOTP_SECRET=your_base32_totp_secret

GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash

NEWSAPI_KEY=your_newsapi_key

# Neon PostgreSQL (use Neon pooled connection string)
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
# Direct/unpooled Neon URL is required for schema migrations.
DATABASE_URL_UNPOOLED=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
PG_POOL_MAX=5
```

Broker-fetched analysis data is strict by default: both daily and five-minute candle sets must contain at least 20 valid, strictly chronological, deduplicated candles. Daily candles must be no more than 5 calendar days old. Five-minute candles must be no more than 20 minutes old during the assumed NSE weekday session (09:15–15:30 IST), or 4 calendar days old outside those hours. The intraday rule uses a weekday/session-time approximation, not an official NSE holiday calendar. Set `strictMarketData: false` only for controlled diagnostics or historical fixtures; it disables freshness checks for both injected and broker-fetched data.

The project does not load `.env` automatically. Copy `.env.example` to your local environment and keep credentials out of source control. NewsAPI is optional; without it, analysis continues with news marked unavailable. Neon PostgreSQL is required when forecast tracking is enabled.

### Set up Neon PostgreSQL

1. Create a Neon project and copy its pooled connection string.
2. Set `DATABASE_URL` in your local environment and deployment environment variables.
3. Run the schema migration once: `npm run db:migrate`.
4. Run `npm test`. Set `TEST_DATABASE_URL` to a disposable migrated database to enable the PostgreSQL integration test.

Forecast history is stored in `predictions`; evaluated 1-, 3- and 5-session outcomes are stored in `prediction_outcomes`. The migration is in `migrations/001_initial.sql`. Never commit the Neon connection string.

### Run AI market analysis

```js
import { analyzeStock } from "./index.js";

const result = await analyzeStock({
  symbol: "RELIANCE",
  exchange: "NSE",
  companyName: "Reliance Industries",
});

console.dir(result.analysis, { depth: null });
console.log("Saved forecast:", result.prediction);
```

To include a sector index, pass it explicitly:

```js
const result = await analyzeStock({
  symbol: "INFY",
  exchange: "NSE",
  companyName: "Infosys",
  marketContextSymbols: {
    benchmark: "Nifty 50",
    sector: "Nifty IT",
  },
});
```


### Validate real market data and Gemini

The opt-in validation runner logs in to Angel One SmartAPI, fetches daily and five-minute NSE candles, runs the real Gemini structured-output request and persists each successful forecast to Neon. It defaults to RELIANCE, TCS, INFY and HDFCBANK and accepts at most four symbols per run. This consumes broker/API quota and creates real forecast-history records. A successful run verifies provider integration for those test cases; it does not establish forecast accuracy or profitability.

Configure `ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`, `ANGEL_MPIN`, `ANGEL_TOTP_SECRET`, `GEMINI_API_KEY`, `DATABASE_URL` and `DATABASE_URL_UNPOOLED`, then run:

```bash
npm run db:migrate
npm run validate:live
```

You can select symbols with `VALIDATION_SYMBOLS=RELIANCE,TCS npm run validate:live`. The GitHub Actions workflow `Live Market + Gemini Validation` is manual-only and uses repository Actions secrets. NewsAPI is optional.

### Durable paper portfolio

Apply the second migration with the direct Neon URL:

```bash
npm run db:migrate
```

The exported API provides `createPaperPortfolio`, `executePaperPortfolioOrder`, `markPaperPortfolio`, `getPaperPortfolio` and `getPaperPortfolioReport`. Orders are simulated market fills only. Buys debit cash including fees; sells require sufficient holdings and realize P&L against fee-inclusive average cost. Every fill updates the order, trade, cash and position records in one database transaction. Mark-to-market snapshots require a price for every open position and persist cash, market value, equity and unrealized P&L.

Example:

```js
import {
  createPaperPortfolio, executePaperPortfolioOrder,
  markPaperPortfolio, getPaperPortfolioReport,
} from "./index.js";

const portfolio = await createPaperPortfolio({
  name: "Research portfolio",
  initialCash: 100_000,
});

await executePaperPortfolioOrder({
  portfolioId: portfolio.id,
  symbol: "RELIANCE",
  side: "BUY",
  quantity: 10,
  price: 1_250,
  feeBps: 5,
});

await markPaperPortfolio({
  portfolioId: portfolio.id,
  prices: { RELIANCE: 1_275 },
});

console.dir(await getPaperPortfolioReport(portfolio.id), { depth: null });
```

The durable portfolio ledger is separate from the legacy `createExecutionAdapter`; it does not call Angel One order placement. Use market prices from a trusted data feed for snapshots; do not treat the sample prices above as live quotes.

### Evaluate saved forecasts

```js
import { evaluateStockPredictions, listPredictions } from "./index.js";

console.log(await evaluateStockPredictions());
console.dir(await listPredictions(), { depth: null });
```

Evaluation is an explicit function call; schedule it after market close if recurring evaluation is needed. Directional scoring classifies returns within ±0.10% as NEUTRAL to avoid treating negligible price noise as a directional win/loss.

### Run a strategy backtest

```js
import {
  smaCrossoverSignals,
  runBacktest,
  summarizeBacktest,
} from "./index.js";

const bars = [
  { open: 100, close: 101 },
  { open: 102, close: 103 },
  { open: 104, close: 102 },
  { open: 101, close: 105 },
  { open: 106, close: 108 },
];

const signals = smaCrossoverSignals(
  bars.map((bar) => bar.close),
  { fastPeriod: 2, slowPeriod: 3 },
);

const result = runBacktest({
  bars,
  signals,
  initialCapital: 100_000,
  quantity: 1,
  feeBps: 5,
  slippageBps: 2,
});

console.log(summarizeBacktest(result, { periodsPerYear: 252 }));
```

## Main modules

| File | Purpose |
|---|---|
| `stock-analysis.js` | Coordinates market data, news, Gemini and forecast tracking |
| `gemini-analysis.js` | Builds the analysis payload and calls Gemini |
| `market-context.js` | Calculates benchmark and sector context |
| `news.js` | Retrieves and normalizes news |
| `prediction-tracker.js` | Persists and evaluates forecasts in PostgreSQL |
| `db.js`, `migrations/` | PostgreSQL pool, transactions and schema |
| `historicaldata.js` | Retrieves daily and five-minute candles |
| `indicator.js` | Technical indicator calculations |
| `strategy.js` | Deterministic SMA-crossover signals |
| `backtest.js`, `portfolio-backtest.js` | Single-stock and portfolio backtesting |
| `risk.js`, `execution.js` | Risk checks and paper execution |
| `performance.js` | Backtest performance metrics |
| `paper-portfolio.js` | Durable cash-account paper portfolio, fills, positions and equity reports |
| `migrations/002_paper_portfolios.sql` | Persistent portfolio ledger schema |

## MVP release boundary

This repository's MVP is a **research and paper-trading library**, not a hosted trading platform or a live execution system. The MVP is complete only when the release gates below pass. New indicators, strategies, agents, brokers, dashboards and integrations are explicitly out of scope until then.

### MVP release gates

- [ ] Unit and integration tests pass on a clean install.
- [ ] Disposable PostgreSQL/Neon migrations and persistence tests pass.
- [ ] Real Angel One read-only market-data validation passes for a representative NSE watchlist, including market-session freshness.
- [ ] Real Gemini structured-output validation passes with the configured production model.
- [ ] Paper portfolio accounting is reconciled against independently calculated buy, sell, fee, cash and P&L examples.
- [ ] Secrets are stored outside source control; logs do not expose credentials or sensitive broker responses.
- [ ] Operational owner, database backup/restore procedure, provider quota handling and incident/recovery procedure are documented.
- [ ] Live order placement remains disabled and is not part of this MVP.

A green unit-test workflow is necessary but does not prove provider compatibility, operational readiness, forecast accuracy or profitability. Do not label the release production-ready until the real-provider and operational gates above have evidence attached.

## Important limitations

- Gemini analysis is advisory; forecasts are not automatically turned into trades.
- Directional probabilities are subjective model estimates, not calibrated predictions.
- Sector context is optional and must be supplied explicitly.
- News coverage depends on the NewsAPI query and plan; verify original sources.
- Backtests use simplified assumptions and do not model all real-world trading costs, fills, taxes or market impact. The multi-symbol simulator assumes synchronous bars; timestamped input is checked for exact alignment, while untimestamped arrays remain the caller’s responsibility.
- The legacy execution adapter's in-memory order list is not durable across restarts. Use the separate PostgreSQL-backed paper portfolio API for persistent portfolio accounting.
- The live adapter remains guarded by explicit opt-in and an injected submit function; it is not wired to Angel One order placement. The durable paper portfolio API has no live mode.

## Disclaimer

For educational and engineering experimentation only. Nothing in this repository is investment advice or a recommendation to buy, sell or hold a security. Historical backtests and AI-generated forecasts do not guarantee future results.
