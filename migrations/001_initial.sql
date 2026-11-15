CREATE TABLE IF NOT EXISTS predictions (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  exchange TEXT NOT NULL,
  forecasted_at TIMESTAMPTZ NOT NULL,
  base_candle_timestamp TIMESTAMPTZ NOT NULL,
  base_close NUMERIC(20, 6) NOT NULL CHECK (base_close > 0),
  outlook TEXT NOT NULL CHECK (outlook IN ('BULLISH', 'BEARISH', 'NEUTRAL')),
  directional_probability_pct NUMERIC(5, 2) NOT NULL CHECK (directional_probability_pct BETWEEN 50 AND 90),
  confidence_label TEXT NOT NULL CHECK (confidence_label IN ('LOW', 'MEDIUM', 'HIGH')),
  horizon_sessions INTEGER[] NOT NULL DEFAULT ARRAY[1,3,5],
  forecast JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS predictions_symbol_forecasted_idx
  ON predictions (symbol, exchange, forecasted_at DESC);
CREATE INDEX IF NOT EXISTS predictions_pending_idx
  ON predictions (base_candle_timestamp)
  WHERE TRUE;

CREATE TABLE IF NOT EXISTS prediction_outcomes (
  prediction_id UUID NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
  horizon_sessions INTEGER NOT NULL CHECK (horizon_sessions IN (1,3,5)),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actual_timestamp TIMESTAMPTZ NOT NULL,
  actual_close NUMERIC(20, 6) NOT NULL CHECK (actual_close > 0),
  return_pct NUMERIC(12, 6) NOT NULL,
  actual_direction TEXT NOT NULL CHECK (actual_direction IN ('BULLISH','BEARISH','NEUTRAL')),
  direction_correct BOOLEAN NOT NULL,
  PRIMARY KEY (prediction_id, horizon_sessions)
);

CREATE INDEX IF NOT EXISTS prediction_outcomes_evaluated_idx
  ON prediction_outcomes (evaluated_at DESC);

CREATE TABLE IF NOT EXISTS paper_orders (
  id UUID PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity NUMERIC(20, 6) NOT NULL CHECK (quantity > 0),
  price NUMERIC(20, 6) NOT NULL CHECK (price > 0),
  product_type TEXT NOT NULL,
  order_type TEXT NOT NULL,
  status TEXT NOT NULL,
  simulated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS paper_orders_symbol_time_idx ON paper_orders(symbol, simulated_at DESC);

CREATE TABLE IF NOT EXISTS paper_positions (
  symbol TEXT PRIMARY KEY,
  quantity NUMERIC(20, 6) NOT NULL,
  average_price NUMERIC(20, 6) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
