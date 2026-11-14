# GenAI Trading Engine

A Node.js market-data and trading-research foundation built around broker APIs and technical-analysis utilities.

> **Status:** Experimental. Market data access depends on valid broker credentials, API availability, exchange calendars, and rate limits. This repository is not investment advice and does not place trades automatically.

## Current capabilities

- Angel One SmartAPI session creation using TOTP.
- Scrip-master download, local caching, and exchange/symbol token lookup.
- Historical daily and five-minute candle retrieval.
- Mid-price derivation from OHLC candle data.

## Architecture

| Module | Responsibility |
|---|---|
| `main.js` | Broker session lifecycle |
| `utlis.js` | Scrip-master cache, token resolution, IST formatting |
| `historicaldata.js` | Daily and intraday candle retrieval |
| `midprice.js` | Derived mid-price series |
| `indicator.js` | Reserved for indicator implementations |

## Configuration

The broker adapter expects a local `config.js` module exporting a `config` object with the following fields:

```js
export const config = {
  apiKey: process.env.ANGEL_API_KEY,
  clientCode: process.env.ANGEL_CLIENT_CODE,
  mpin: process.env.ANGEL_MPIN,
  totpSecret: process.env.ANGEL_TOTP_SECRET,
};
```

Keep credentials in environment variables or an ignored local configuration file. Never commit API keys, MPINs, TOTP secrets, access tokens, or feed tokens.

## Setup

```bash
npm install
npm test
```

Use a supported Node.js LTS release. Before calling broker-backed functions, provide valid credentials and confirm the broker SDK's current API contract.

## Data semantics and limitations

- Candle rows returned by the fetch helpers are represented as `[open, high, low, close, volume]`; timestamps are removed by the current public helpers.
- The mid-price is `(high + low) / 2`. It is a derived price, not an executable quote or guaranteed fill price.
- Exchange holidays are not fully modeled by weekend checks; historical retrieval should treat missing sessions as normal.
- Broker responses can be incomplete, delayed, throttled, or unavailable. Callers should validate returned series length before using them in strategy logic.
- Never substitute another instrument's token when symbol resolution fails.

## Development principles

1. Fail closed when instrument identity cannot be resolved.
2. Keep date/time conversion explicit and testable.
3. Separate importable library modules from executable examples.
4. Validate external API payloads at module boundaries.
5. Do not interpret a successful data fetch as a trading signal.

## Roadmap

- [ ] Add contract tests around SmartAPI response shapes.
- [ ] Add exchange-calendar-aware session boundaries.
- [ ] Add typed candle objects and timestamp-preserving APIs.
- [ ] Add rate limiting, bounded retries, and structured observability.
- [ ] Add deterministic indicator calculations with unit tests.

## Disclaimer

This project is for educational and engineering experimentation. It does not provide financial advice. Validate data quality, broker terms, market rules, and strategy behavior independently before any live-market use.
