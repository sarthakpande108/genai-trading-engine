CREATE TABLE IF NOT EXISTS paper_portfolios (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL DEFAULT 'INR',
  initial_cash NUMERIC(20, 6) NOT NULL CHECK (initial_cash > 0),
  cash_balance NUMERIC(20, 6) NOT NULL CHECK (cash_balance >= 0),
  realized_pnl NUMERIC(20, 6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_portfolio_orders (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
  order_type TEXT NOT NULL DEFAULT 'MARKET',
  status TEXT NOT NULL CHECK (status IN ('FILLED','REJECTED')),
  fill_price NUMERIC(20, 6),
  filled_quantity NUMERIC(20, 6) NOT NULL DEFAULT 0,
  fee NUMERIC(20, 6) NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((status = 'FILLED' AND fill_price IS NOT NULL AND fill_price > 0 AND filled_quantity = quantity) OR status = 'REJECTED')
);
CREATE INDEX IF NOT EXISTS paper_portfolio_orders_history_idx
  ON paper_portfolio_orders(portfolio_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_portfolio_positions (
  portfolio_id UUID NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
  average_cost NUMERIC(20, 6) NOT NULL CHECK (average_cost > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, symbol)
);

CREATE TABLE IF NOT EXISTS paper_portfolio_trades (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  order_id UUID NOT NULL UNIQUE REFERENCES paper_portfolio_orders(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
  price NUMERIC(20, 6) NOT NULL CHECK (price > 0),
  fee NUMERIC(20, 6) NOT NULL DEFAULT 0,
  realized_pnl NUMERIC(20, 6) NOT NULL DEFAULT 0,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS paper_portfolio_trades_history_idx
  ON paper_portfolio_trades(portfolio_id, executed_at DESC);

CREATE TABLE IF NOT EXISTS paper_portfolio_equity_snapshots (
  id UUID PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES paper_portfolios(id) ON DELETE CASCADE,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cash NUMERIC(20, 6) NOT NULL,
  market_value NUMERIC(20, 6) NOT NULL,
  equity NUMERIC(20, 6) NOT NULL,
  unrealized_pnl NUMERIC(20, 6) NOT NULL,
  realized_pnl NUMERIC(20, 6) NOT NULL,
  prices JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS paper_portfolio_equity_history_idx
  ON paper_portfolio_equity_snapshots(portfolio_id, snapshot_at DESC);
