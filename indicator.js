// indicators.js
// -----------------------------------------------------------------------------
// ✅ Clean mathematical indicator helpers (LLM & quant-ready)
// -----------------------------------------------------------------------------
// Each function returns full arrays aligned to input prices
// Works perfectly with your midprice.js output
// -----------------------------------------------------------------------------

/**
 * Exponential Moving Average (EMA)
 * @param {number[]} prices - Array of prices
 * @param {number} period - Lookback period
 * @returns {number[]} EMA series
 */
export function getEma(prices, period) {
    if (prices.length < period) throw new Error(`Need at least ${period} prices`);
    const multiplier = 2 / (period + 1);
  
    // Initial SMA as starting EMA
    const sma = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const emas = Array(period - 1).fill(sma); // start with SMA repeated to align
  
    let emaPrev = sma;
    for (let i = period; i < prices.length; i++) {
      emaPrev = (prices[i] - emaPrev) * multiplier + emaPrev;
      emas.push(emaPrev);
    }
    return emas;
  }
  
  /**
   * Relative Strength Index (RSI)
   * @param {number[]} prices - Array of prices
   * @param {number} period - RSI lookback
   * @returns {number[]} RSI series
   */
  export function getRsi(prices, period = 14) {
    if (prices.length < period + 1) throw new Error(`Need ${period + 1} prices`);
    const rsi = Array(prices.length).fill(null);
  
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) gains += diff; else losses -= diff;
    }
  
    gains /= period;
    losses /= period;
  
    let rs = gains / (losses || 1e-10);
    rsi[period] = 100 - (100 / (1 + rs));
  
    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        gains = (gains * (period - 1) + diff) / period;
        losses = (losses * (period - 1)) / period;
      } else {
        gains = (gains * (period - 1)) / period;
        losses = (losses * (period - 1) - diff) / period;
      }
  
      rs = gains / (losses || 1e-10);
      rsi[i] = 100 - (100 / (1 + rs));
    }
  
    // Fill initial nulls for alignment
    return rsi.map((v, i) => v ?? rsi[period]);
  }
  
  /**
   * Moving Average Convergence Divergence (MACD)
   * MACD = EMA(12) - EMA(26)
   * Signal = EMA(9) of MACD
   * Histogram = MACD - Signal
   * @param {number[]} prices
   * @returns {{ macdLine: number[], signalLine: number[], histogram: number[] }}
   */
  export function getMacd(prices) {
    if (prices.length < 26) throw new Error("Need at least 26 prices for MACD");
  
    const ema12 = getEma(prices, 12);
    const ema26 = getEma(prices, 26);
    const macdLine = ema12.map((v, i) => (v ?? 0) - (ema26[i] ?? 0));
  
    // align for EMA(9) signal line
    const validMacd = macdLine.filter((x) => !isNaN(x));
    const signalLine = getEma(validMacd, 9);
    const fullSignal = Array(macdLine.length - signalLine.length)
      .fill(signalLine[0])
      .concat(signalLine);
    const histogram = macdLine.map((v, i) => v - fullSignal[i]);
  
    return { macdLine, signalLine: fullSignal, histogram };
  }
  
  /**
   * Simple helper for midprice (mean of high+low)
   * @param {Array<[open, high, low, close, volume]>} candles
   * @returns {number[]}
   */
  export function getMidPrices(candlesticks) {
    return candlesticks.map((c) => ((c[1] + c[2]) / 2));
  }
  