# Trading Engine

A modular Node.js toolkit for broker-connected market data, technical indicators, strategy research, risk sizing, and historical backtesting.

> **Status:** Experimental research software. Broker access depends on valid credentials, API availability, exchange calendars, and rate limits. The project does not submit live orders automatically and is not investment advice.

## Features

- Angel One SmartAPI session creation using TOTP and environment-based credentials.
- Scrip-master download, local caching, and exact exchange/symbol token resolution.
- Historical daily and five-minute candle retrieval, with optional timestamp-preserving APIs.
- Mid-price derivation from OHLC candle data.
- SMA, EMA, RSI, true-range, and ATR calculations.
- Deterministic SMA-crossover target-position signals.
- Risk-based position sizing and pre-trade notional/capital checks.
- Long/flat backtesting with next-bar-open execution, fees, slippage, and drawdown reporting.
- Performance analytics: CAGR, annualized volatility, Sharpe ratio, maximum drawdown, win rate, and profit factor.
- Multi-instrument, shared-cash portfolio backtesting with no-leverage purchase checks.
- Paper execution adapter with order-risk checks; live execution remains disabled unless explicitly enabled and supplied with a broker adapter.
- A single public entry point through `index.js`.

## Project structure

| Module | Responsibility |
|---|---|
| `index.js` | Public exports |
| `main.js` | Angel One broker session lifecycle |
| `utlis.js` | Scrip-master cache, token resolution, IST formatting |
| `historicaldata.js` | Daily and intraday candle retrieval |
| `midprice.js` | Derived mid-price series |
| `indicator.js` | SMA, EMA, RSI, true range, and ATR |
| `strategy.js` | SMA-crossover target-position signals |
| `risk.js` | Position sizing and order-risk validation |
| `backtest.js` | Long/flat backtesting with next-bar execution |
| `performance.js` | Backtest performance statistics |
| `portfolio-backtest.js` | Multi-instrument shared-cash simulation |
| `execution.js` | Guarded paper/live execution boundary |
| `test/` | Unit tests |

## Requirements and setup

- Node.js 20 or newer.
- npm.
- Angel One SmartAPI credentials only for broker-connected data functions.

```bash
npm install
npm test
```

Set credentials in the process environment (or a local `.env` file loaded by your own runtime):

```bash
ANGEL_API_KEY=your_api_key
ANGEL_CLIENT_CODE=your_client_code
ANGEL_MPIN=your_mpin
ANGEL_TOTP_SECRET=your_base32_totp_secret
```

Never commit API keys, MPINs, TOTP secrets, access tokens, or feed tokens. The repository intentionally does not load a dotenv file automatically.

## Quick start: strategy research

All strategy signals are generated using the close of each bar. The backtester executes the previous bar's signal at the next bar's open.

```js
import { smaCrossoverSignals, runBacktest, summarizeBacktest } from "./index.js";

const bars = [
  { open: 100, close: 101 },
  { open: 102, close: 103 },
  { open: 104, close: 102 },
  { open: 101, close: 105 },
  { open: 106, close: 108 },
];

const closes = bars.map((bar) => bar.close);
const signals = smaCrossoverSignals(closes, { fastPeriod: 2, slowPeriod: 3 });

const result = runBacktest({
  bars,
  signals,
  initialCapital: 100_000,
  quantity: 1,
  feeBps: 5,
  slippageBps: 2,
});

const metrics = summarizeBacktest(result, { periodsPerYear: 252 });
console.log({ result, metrics });
```

## Public API

- `smartConnect(options?)` / `clearSmartSession()`
- `downloadScripMaster(cachePath?, options?)`
- `findSymbolToken(master, exchange, symbol)`
- `fetchLast20DaysDailyCandles(symbol, exchange)`
- `fetchLast20FiveMinCandlesRobust(symbol, exchange)`
- `fetchDailyCandlesWithTimestamps(symbol, exchange)` / `fetchFiveMinuteCandlesWithTimestamps(symbol, exchange)`
- `runPortfolioBacktest(options)`
- `createExecutionAdapter(options)`
- `getStockMidPrices(symbol, exchange?)`
- `sma(values, period)`, `ema(values, period)`, `rsi(values, period)`, `trueRange(highs, lows, closes)`, `atr(highs, lows, closes, period)`
- `smaCrossoverSignals(closes, options?)`
- `calculatePositionSize(options)`, `validateOrderRisk(options)`
- `runBacktest(options)`
- `summarizeBacktest(result, options?)`

## Research assumptions and limitations

- The legacy candle helpers return `[open, high, low, close, volume]`; the timestamp-preserving helpers return `[timestamp, open, high, low, close, volume]`.
- The mid-price is `(high + low) / 2`. It is not an executable quote or guaranteed fill price.
- SMA crossover signals are long/flat only. A signal is calculated after a completed close and is eligible for execution at the next bar open.
- The backtester models fixed quantity, fees, and slippage. It does not model margin, partial fills, taxes, financing, dividends, corporate actions, or market impact.
- Performance annualization assumes equally spaced observations. Choose `periodsPerYear` to match the bar frequency (for example, 252 for daily observations); do not use daily annualization for intraday bars.
- Exchange holidays are not fully modeled by weekend checks. Missing sessions should be treated as normal and validated against an exchange calendar.
- Broker responses can be incomplete, delayed, throttled, or unavailable. Validate data quality and sample counts before using data in research.
- The portfolio simulator is long-only, fixed-quantity and cash-constrained. It does not support shorts, margin, partial fills, portfolio rebalancing, or asynchronous fills.
- The execution adapter defaults to paper mode. Live mode requires an explicit opt-in and an injected broker submit function; it is not pre-wired to Angel One order placement. Never enable live mode without independent review and broker-side safeguards.
- Exchange holidays are not fully modeled by the historical retrieval helpers. A proper exchange-calendar integration remains outstanding.
- This is not a production live-trading system. Broker order reconciliation, exchange-calendar integration, persistent portfolio state, operational monitoring, and regulatory controls remain outstanding.

## Engineering principles

1. Fail closed when instrument identity cannot be resolved.
2. Avoid look-ahead bias by executing signals no earlier than the next bar.
3. Include transaction costs in backtest assumptions.
4. Keep position sizing and order checks separate from order placement.
5. Keep date/time conversion explicit and testable.
6. Validate external API payloads at module boundaries.
7. Never interpret a successful data fetch as a trading signal.

## Roadmap

- [ ] Add contract tests against recorded SmartAPI response fixtures.
- [ ] Replace weekend-only date traversal with an exchange-calendar provider.
- [ ] Preserve timestamps in a typed candle API.
- [ ] Add bounded retries, rate limiting, and structured logging.
- [ ] Add portfolio-level exposure constraints, rebalancing and sector limits.
- [ ] Add a maintained exchange-calendar provider and holiday-aware historical date traversal.
- [ ] Add bounded retries, request throttling and structured logs around broker calls.
- [ ] Add broker-specific order adapter only after paper-trading and reconciliation tests.
- [x] Add deterministic indicators and unit tests.
- [x] Add risk sizing and pre-trade validation primitives.
- [x] Add next-bar-open backtesting with transaction costs.
- [x] Add a sample SMA-crossover strategy and performance analytics.
- [x] Add timestamp-preserving candle retrieval functions.
- [x] Add shared-cash multi-instrument backtesting.
- [x] Add a paper-first execution adapter with explicit live-mode guard.

## Disclaimer

For educational and engineering experimentation only. This repository does not provide financial advice. Historical performance is not a guarantee of future results. Independently validate data quality, broker terms, market rules, and strategy behavior before considering any live-market use.
