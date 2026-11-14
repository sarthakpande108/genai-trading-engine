# Trading Engine

A Gemini-powered stock-analysis engine that combines Angel One OHLCV data, technical indicators, and LLM reasoning, alongside strategy research, risk sizing, and historical backtesting.

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
- Gemini stock analysis that interprets daily and five-minute OHLCV candles together with calculated technical indicators and returns structured outlooks, evidence, risks, and approximate price levels.
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
| `gemini-analysis.js` | OHLCV feature preparation and Gemini structured analysis |
| `stock-analysis.js` | End-to-end Angel One data to Gemini analysis workflow |
| `test/` | Unit tests |

## Requirements and setup

- Node.js 20 or newer.
- npm.
- Angel One SmartAPI credentials for broker-connected data functions.
- A Gemini API key for AI analysis (create one in Google AI Studio).

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
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.8-flash
```

Never commit API keys, MPINs, TOTP secrets, access tokens, or feed tokens. The repository intentionally does not load a dotenv file automatically. Gemini uses the GEMINI_MODEL environment variable when set and otherwise defaults to gemini-3.8-flash.

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

## Gemini AI stock analysis

The primary AI workflow is:

`Angel One daily + five-minute OHLCV → indicator calculations → Gemini → structured stock analysis`

```js
import { analyzeStock } from "./index.js";

const result = await analyzeStock({
  symbol: "RELIANCE",
  exchange: "NSE",
});

console.dir(result.analysis, { depth: null });
```

The workflow sends Gemini the latest 20 daily candles and latest 20 five-minute candles, plus calculated SMA(10/20), EMA(9/20), RSI(14), ATR(14), volume context, recent percentage changes, and recent high/low range. Gemini weighs the daily trend more heavily and uses intraday data for confirmation or divergence.

The structured response includes:
- Bullish, bearish, or neutral outlook and a 1–5 trading-session horizon.
- Subjective directional probability estimate and confidence label.
- Explanation of indicator confluence/conflicts and bullish/bearish factors.
- Approximate support/resistance levels, invalidation condition, risks, and scenario.

**Important:** Gemini is interpreting the supplied technical data; it is not receiving fundamentals, company filings, news, live order-book depth, or broader market context in this workflow. The probability is a subjective LLM estimate, not a calibrated forecast. The system does not automatically place orders. Test forecasts over time and calibrate probability estimates against out-of-sample outcomes before relying on them.
## Public API

- `smartConnect(options?)` / `clearSmartSession()`
- `downloadScripMaster(cachePath?, options?)`
- `findSymbolToken(master, exchange, symbol)`
- `fetchLast20DaysDailyCandles(symbol, exchange)`
- `fetchLast20FiveMinCandlesRobust(symbol, exchange)`
- `fetchDailyCandlesWithTimestamps(symbol, exchange)` / `fetchFiveMinuteCandlesWithTimestamps(symbol, exchange)`
- `analyzeStock({ symbol, exchange })` — fetch market data and request Gemini analysis
- `buildStockAnalysisPayload(options)` / `analyzeStockDataWithGemini(payload, options)` — lower-level, independently testable AI functions
- `runPortfolioBacktest(options)
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
- [ ] Expand the market context with benchmark/index trend, sector strength, and verified news/fundamentals before calling Gemini.
- [ ] Store prediction snapshots and evaluate directional accuracy, calibration, and performance out of sample.
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
- [x] Add Gemini-powered analysis of daily and intraday candles plus technical indicators.

## Disclaimer

For educational and engineering experimentation only. This repository does not provide financial advice. Historical performance is not a guarantee of future results. Independently validate data quality, broker terms, market rules, and strategy behavior before considering any live-market use.
