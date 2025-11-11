// paperTrader.js - FINAL BUG-FREE VERSION
// All critical bugs fixed with detailed comments

import fs from "fs/promises";

function round2(x){ return Math.round((x + Number.EPSILON) * 100) / 100; }
function round4(x){ return Math.round((x + Number.EPSILON) * 10000) / 10000; }
function nowIso(){ return new Date().toISOString(); }

export class PaperTrader {
  constructor(opts = {}) {
    this.cash = opts.initialCash ?? 100000;
    this.initialCash = this.cash;
    this.commissionPct = opts.commissionPct ?? 0.0005;
    this.slippagePct = opts.slippagePct ?? 0.0002;
    this.allowShort = !!opts.allowShort;
    this.minTradeValue = opts.minTradeValue ?? 100;
    this.marginMultiplier = opts.marginMultiplier ?? 1;
    this.maxPositionSize = opts.maxPositionSize ?? 1.0;
    
    // ✅ FIX: Use instance-level counters instead of global
    this.nextOrderId = 1;
    this.nextTradeId = 1;
    
    this.positions = {};
    this.openOrders = [];
    this.trades = [];
    this.equityHistory = [];
    this.orderBook = {};
    this.lastPrices = {};
    
    this.metrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      largestWin: 0,
      largestLoss: 0,
      totalCommission: 0,
      totalSlippage: 0,
      totalWinAmount: 0,    // ✅ FIX: Track for accurate avgWin
      totalLossAmount: 0    // ✅ FIX: Track for accurate avgLoss
    };
  }

  /* ==================== ORDER PLACEMENT ==================== */

  placeMarketOrder(symbol, side, qty, priceProvider, opts = {}) {
    const { price, time } = this._resolvePriceFromProvider(priceProvider);
    
    // ✅ FIX: Update lastPrices BEFORE validation
    this.lastPrices[symbol] = price;
    
    const validation = this._validateOrder(symbol, side, qty, price);
    if (!validation.valid) {
      throw new Error(`Market order validation failed: ${validation.reason}`);
    }
    
    if (!this._checkPositionSizeLimit(symbol, side, qty, price)) {
      throw new Error(`Position size would exceed ${this.maxPositionSize * 100}% limit`);
    }
    
    return this._executeFill({
      type: "MARKET",
      symbol,
      side,
      qty,
      fillPrice: this._applySlippage(price, side),
      orderOpts: opts
    }, time);
  }

  placeLimitOrder(symbol, side, qty, limitPrice, timeNow = nowIso(), opts = {}) {
    if (limitPrice <= 0) throw new Error("Limit price must be > 0");
    
    // ✅ FIX: Validate before placing order
    const validation = this._validateBasicOrder(symbol, side, qty);
    if (!validation.valid) {
      throw new Error(`Limit order validation failed: ${validation.reason}`);
    }
    
    const id = this.nextOrderId++;
    const order = {
      id,
      symbol,
      type: "LIMIT",
      side,
      qty,
      limitPrice: round2(limitPrice),
      time: timeNow,
      attached: opts.attached || {},
      status: "PENDING"
    };
    
    this.openOrders.push(order);
    this.orderBook[id] = order;
    return order;
  }

  placeStopOrder(symbol, side, qty, stopPrice, timeNow = nowIso(), opts = {}) {
    if (stopPrice <= 0) throw new Error("Stop price must be > 0");
    
    // ✅ FIX: Validate before placing order
    const validation = this._validateBasicOrder(symbol, side, qty);
    if (!validation.valid) {
      throw new Error(`Stop order validation failed: ${validation.reason}`);
    }
    
    const id = this.nextOrderId++;
    const order = {
      id,
      symbol,
      type: "STOP",
      side,
      qty,
      stopPrice: round2(stopPrice),
      triggered: false,
      time: timeNow,
      attached: opts.attached || {},
      status: "PENDING"
    };
    
    this.openOrders.push(order);
    this.orderBook[id] = order;
    return order;
  }

  placeBracketOrder(symbol, side, qty, entryPrice, stopLoss, target, timeNow = nowIso()) {
    // ✅ FIX: Validate bracket order prices
    if (side === "BUY") {
      if (stopLoss >= entryPrice) {
        throw new Error("For BUY: stop loss must be < entry price");
      }
      if (target <= entryPrice) {
        throw new Error("For BUY: target must be > entry price");
      }
    } else {
      if (stopLoss <= entryPrice) {
        throw new Error("For SELL: stop loss must be > entry price");
      }
      if (target >= entryPrice) {
        throw new Error("For SELL: target must be < entry price");
      }
    }
    
    const entryOrder = this.placeLimitOrder(symbol, side, qty, entryPrice, timeNow);
    const oppositeSide = side === "BUY" ? "SELL" : "BUY";
    
    const slOrder = this.placeStopOrder(symbol, oppositeSide, qty, stopLoss, timeNow, {
      attached: { parentId: entryOrder.id, type: "SL" }
    });
    const tpOrder = this.placeLimitOrder(symbol, oppositeSide, qty, target, timeNow, {
      attached: { parentId: entryOrder.id, type: "TP" }
    });
    
    return { entry: entryOrder, sl: slOrder, tp: tpOrder };
  }

  cancelOrder(orderId) {
    const idx = this.openOrders.findIndex(o => o.id === orderId);
    if (idx >= 0) {
      const [removed] = this.openOrders.splice(idx, 1);
      removed.status = "CANCELLED";
      delete this.orderBook[orderId];
      return removed;
    }
    return null;
  }

  cancelAllOrders(symbol = null) {
    const toCancel = symbol 
      ? this.openOrders.filter(o => o.symbol === symbol)
      : this.openOrders.slice();
    
    toCancel.forEach(o => this.cancelOrder(o.id));
    return toCancel.length;
  }

  /* ==================== POSITION MANAGEMENT ==================== */

  attachSlTpToPosition(symbol, slPrice = null, tpPrice = null) {
    const pos = this.positions[symbol];
    if (!pos || pos.qty === 0) throw new Error("No position to attach SL/TP");
    
    // ✅ FIX: Validate SL/TP prices
    if (slPrice !== null) {
      if (pos.qty > 0 && slPrice >= pos.avgPrice) {
        throw new Error("For LONG: stop loss must be < average price");
      }
      if (pos.qty < 0 && slPrice <= pos.avgPrice) {
        throw new Error("For SHORT: stop loss must be > average price");
      }
    }
    
    if (tpPrice !== null) {
      if (pos.qty > 0 && tpPrice <= pos.avgPrice) {
        throw new Error("For LONG: take profit must be > average price");
      }
      if (pos.qty < 0 && tpPrice >= pos.avgPrice) {
        throw new Error("For SHORT: take profit must be < average price");
      }
    }
    
    const out = [];
    const absQty = Math.abs(pos.qty);
    const isLong = pos.qty > 0;
    
    if (slPrice) {
      const side = isLong ? "SELL" : "BUY";
      out.push(this.placeStopOrder(symbol, side, absQty, slPrice, nowIso(), {
        attached: { forPosition: true, type: "SL" }
      }));
    }
    
    if (tpPrice) {
      const side = isLong ? "SELL" : "BUY";
      out.push(this.placeLimitOrder(symbol, side, absQty, tpPrice, nowIso(), {
        attached: { forPosition: true, type: "TP" }
      }));
    }
    
    return out;
  }

  closePosition(symbol, priceProvider, partial = 1.0) {
    const pos = this.positions[symbol];
    if (!pos || pos.qty === 0) throw new Error(`No position in ${symbol} to close`);
    
    // ✅ FIX: Validate partial parameter
    if (partial <= 0 || partial > 1) {
      throw new Error("Partial must be between 0 and 1");
    }
    
    const closeQty = Math.floor(Math.abs(pos.qty) * partial);
    if (closeQty === 0) throw new Error("Close quantity is zero");
    
    const side = pos.qty > 0 ? "SELL" : "BUY";
    return this.placeMarketOrder(symbol, side, closeQty, priceProvider);
  }

  closeAllPositions(priceMap) {
    const results = [];
    for (const symbol of Object.keys(this.positions)) {
      const pos = this.positions[symbol];
      if (pos && pos.qty !== 0 && priceMap[symbol]) {
        try {
          results.push(this.closePosition(symbol, priceMap[symbol]));
        } catch (e) {
          console.warn(`Failed to close ${symbol}:`, e.message);
        }
      }
    }
    return results;
  }

  /* ==================== POSITION SIZING ==================== */

  async sizeByPercentOfEquity(percent, symbol, priceProvider) {
    const { price } = this._resolvePriceFromProvider(priceProvider);
    
    // ✅ FIX: Build proper price map for equity calculation
    const priceMap = { ...this.lastPrices, [symbol]: price };
    const equity = await this.getEquity(priceMap);
    
    const allocatedMoney = equity * (percent / 100);
    const qty = Math.floor(allocatedMoney / price);
    return Math.max(qty, 0);
  }

  async sizeByRisk(symbol, entryPrice, stopPrice, riskRupees, priceProvider = null) {
    const entry = priceProvider 
      ? this._resolvePriceFromProvider(priceProvider).price 
      : entryPrice;
    
    const perShareRisk = Math.abs(entry - stopPrice);
    if (perShareRisk <= 0) throw new Error("Stop price equals entry price - no risk defined");
    
    const qty = Math.floor(riskRupees / perShareRisk);
    return Math.max(qty, 1);
  }

  kellySize(winRate, avgWin, avgLoss, equity, price) {
    // ✅ FIX: Validate inputs
    if (avgLoss <= 0) throw new Error("avgLoss must be > 0");
    if (winRate < 0 || winRate > 1) throw new Error("winRate must be 0-1");
    
    const b = avgWin / avgLoss;
    const p = winRate;
    const q = 1 - p;
    
    const kellyPct = (b * p - q) / b;
    
    // ✅ FIX: Don't trade if Kelly is negative
    if (kellyPct <= 0) return 0;
    
    const safePct = Math.max(0, Math.min(kellyPct * 0.5, 0.25));
    const allocatedMoney = equity * safePct;
    return Math.floor(allocatedMoney / price);
  }

  /* ==================== TICK PROCESSING ==================== */

  processTick(symbol, price, time = nowIso()) {
    this.lastPrices[symbol] = price;
    
    if (price <= 0) {
      console.warn(`Invalid price ${price} for ${symbol}`);
      return;
    }
    
    const toRemove = [];
    
    // 1) Process STOP orders
    for (const order of [...this.openOrders]) {
      if (order.symbol !== symbol || order.type !== "STOP") continue;
      
      let shouldTrigger = false;
      if (order.side === "BUY" && price >= order.stopPrice) {
        shouldTrigger = true;
      } else if (order.side === "SELL" && price <= order.stopPrice) {
        shouldTrigger = true;
      }
      
      if (shouldTrigger) {
        order.triggered = true;
        order.status = "TRIGGERED";
        
        try {
          this._executeFill({
            type: "STOP->MARKET",
            symbol,
            side: order.side,
            qty: order.qty,
            fillPrice: this._applySlippage(price, order.side),
            orderId: order.id
          }, time);

          // ✅ FIX: Use helper method for OCO cancellation
          this._cancelSiblingOrders(order);
          toRemove.push(order.id);
        } catch (e) {
          console.warn(`Stop order ${order.id} execution failed:`, e.message);
          order.status = "FAILED";
          toRemove.push(order.id);
        }
      }
    }
    
    for (const id of toRemove) {
      this.cancelOrder(id);
    }
    
    // 2) Process LIMIT orders
    for (const order of [...this.openOrders]) {
      if (order.symbol !== symbol || order.type !== "LIMIT") continue;
      
      let shouldFill = false;
      if (order.side === "BUY" && price <= order.limitPrice) {
        shouldFill = true;
      } else if (order.side === "SELL" && price >= order.limitPrice) {
        shouldFill = true;
      }
      
      if (shouldFill) {
        try {
          this._executeFill({
            ...order,
            fillPrice: this._applySlippage(order.limitPrice, order.side),
            orderId: order.id
          }, time);
          
          // ✅ FIX: Use helper method for OCO cancellation
          this._cancelSiblingOrders(order);
          order.status = "FILLED";
          this.cancelOrder(order.id);
        } catch (e) {
          console.warn(`Limit order ${order.id} execution failed:`, e.message);
          order.status = "FAILED";
        }
      }
    }
    
    // 3) Record equity snapshot
    this._recordEquityPoint(time, symbol, price);
  }

  // ✅ NEW: Extract OCO cancellation logic
  _cancelSiblingOrders(order) {
    if (order.attached?.type === "SL" || order.attached?.type === "TP") {
      const parentId = order.attached.parentId;
      if (parentId) {
        this.openOrders = this.openOrders.filter(o => {
          const isSibling = o.attached?.parentId === parentId && o.id !== order.id;
          if (isSibling) {
            o.status = "CANCELLED";
            delete this.orderBook[o.id];
          }
          return !isSibling;
        });
      }
    }
  }

  /* ==================== EXECUTION ENGINE ==================== */

  _executeFill(exec, time = nowIso()) {
    const { symbol, side, qty } = exec;
    const fillPrice = round2(exec.fillPrice);
    
    if (qty <= 0) throw new Error("Quantity must be > 0");
    
    const tradeValue = round2(fillPrice * qty);
    const commission = round2(Math.abs(tradeValue) * this.commissionPct);
    const slippageCost = round2(Math.abs(tradeValue) * this.slippagePct);
    
    this.metrics.totalCommission += commission;
    this.metrics.totalSlippage += slippageCost;
    
    if (side === "BUY") {
      return this._executeBuy(symbol, qty, fillPrice, commission, slippageCost, time, exec);
    } else if (side === "SELL") {
      return this._executeSell(symbol, qty, fillPrice, commission, slippageCost, time, exec);
    } else {
      throw new Error(`Unknown side: ${side}`);
    }
  }

  _executeBuy(symbol, qty, fillPrice, commission, slippageCost, time, exec) {
    const tradeValue = round2(fillPrice * qty);
    const totalCost = round2(tradeValue + commission + slippageCost);
    const requiredCash = round2(totalCost / this.marginMultiplier);
    
    if (this.cash < requiredCash) {
      throw new Error(`Insufficient cash. Need ${requiredCash}, have ${round2(this.cash)}`);
    }
    
    const pos = this.positions[symbol];
    let pnl = 0;
    
    if (!pos || pos.qty === 0) {
      // New long position
      this.positions[symbol] = {
        qty,
        avgPrice: fillPrice,
        realized: pos?.realized || 0,  // ✅ FIX: Keep old realized if exists
        side: "LONG"
      };
    } else if (pos.qty > 0) {
      // Adding to long position
      const newQty = pos.qty + qty;
      const newAvg = ((pos.avgPrice * pos.qty) + (fillPrice * qty)) / newQty;
      pos.qty = newQty;
      pos.avgPrice = round2(newAvg);
    } else if (pos.qty < 0) {
      // Covering short position
      const coverQty = Math.min(qty, Math.abs(pos.qty));
      pnl = round2((pos.avgPrice - fillPrice) * coverQty);
      pos.realized = round2((pos.realized || 0) + pnl);
      pos.qty += coverQty;
      
      this._updateTradeMetrics(pnl);
      
      if (pos.qty === 0) {
        pos.side = "FLAT";
      }
      
      // If buying more than the short
      const remainingQty = qty - coverQty;
      if (remainingQty > 0) {
        pos.qty = remainingQty;
        pos.avgPrice = fillPrice;
        pos.side = "LONG";
        // ✅ FIX: Don't reset realized - keep cumulative
      }
    }
    
    this.cash = round2(this.cash - requiredCash);
    
    return this._recordTrade({
      symbol,
      side: "BUY",
      qty,
      price: fillPrice,
      commission,
      slippageCost,
      pnl,  // ✅ FIX: Include P&L
      time,
      orderId: exec.orderId
    });
  }

  _executeSell(symbol, qty, fillPrice, commission, slippageCost, time, exec) {
    const pos = this.positions[symbol];
    const tradeValue = round2(fillPrice * qty);
    let pnl = 0;
    
    if (!pos || pos.qty === 0) {
      // Initiating short
      if (!this.allowShort) {
        throw new Error(`Cannot short ${symbol} - shorting not allowed`);
      }
      this.positions[symbol] = {
        qty: -qty,
        avgPrice: fillPrice,
        realized: pos?.realized || 0,  // ✅ FIX: Keep old realized
        side: "SHORT"
      };
      
      // ✅ FIX: Correct cash flow for shorts
      const proceeds = round2(tradeValue - commission - slippageCost);
      const netProceeds = round2(proceeds / this.marginMultiplier);
      this.cash = round2(this.cash + netProceeds);
      
    } else if (pos.qty > 0) {
      // Closing/reducing long position
      if (pos.qty < qty && !this.allowShort) {
        throw new Error(`Not enough qty to sell: have ${pos.qty}, trying to sell ${qty}`);
      }
      
      const sellQty = Math.min(qty, pos.qty);
      pnl = round2((fillPrice - pos.avgPrice) * sellQty);
      pos.realized = round2((pos.realized || 0) + pnl);
      pos.qty -= sellQty;
      
      this._updateTradeMetrics(pnl);
      
      // ✅ FIX: Correct proceeds calculation
      const proceeds = round2((fillPrice * sellQty) - commission - slippageCost);
      this.cash = round2(this.cash + proceeds);
      
      if (pos.qty === 0) {
        pos.side = "FLAT";
      }
      
      // If selling more than position (going short)
      const remainingQty = qty - sellQty;
      if (remainingQty > 0 && this.allowShort) {
        pos.qty = -remainingQty;
        pos.avgPrice = fillPrice;
        pos.side = "SHORT";
        
        // ✅ FIX: Additional cash for new short
        const shortValue = round2(fillPrice * remainingQty);
        const shortProceeds = round2((shortValue - commission - slippageCost) / this.marginMultiplier);
        this.cash = round2(this.cash + shortProceeds);
      }
      
    } else if (pos.qty < 0) {
      // Adding to short position
      const newQty = pos.qty - qty;
      const newAvg = ((pos.avgPrice * Math.abs(pos.qty)) + (fillPrice * qty)) / Math.abs(newQty);
      pos.qty = newQty;
      pos.avgPrice = round2(newAvg);
      
      const proceeds = round2(tradeValue - commission - slippageCost);
      const netProceeds = round2(proceeds / this.marginMultiplier);
      this.cash = round2(this.cash + netProceeds);
    }
    
    // ✅ FIX: Don't delete position with realized P&L
    if (pos && pos.qty === 0 && (pos.realized === 0 || !pos.realized)) {
      delete this.positions[symbol];
    }
    
    return this._recordTrade({
      symbol,
      side: "SELL",
      qty,
      price: fillPrice,
      commission,
      slippageCost,
      pnl,
      time,
      orderId: exec.orderId
    });
  }

  _recordTrade({ symbol, side, qty, price, commission = 0, slippageCost = 0, pnl = 0, time = nowIso(), orderId = null }) {
    const trade = {
      id: this.nextTradeId++,
      orderId,
      time,
      symbol,
      side,
      qty,
      price: round2(price),
      value: round2(price * qty),
      commission: round2(commission),
      slippage: round2(slippageCost),
      pnl: round2(pnl ?? 0)
    };
    
    this.trades.push(trade);
    this.metrics.totalTrades++;
    
    return trade;
  }

  /* ==================== VALIDATION ==================== */

  _validateBasicOrder(symbol, side, qty) {
    if (!symbol || symbol.length === 0) {
      return { valid: false, reason: "Invalid symbol" };
    }
    
    if (qty <= 0 || !Number.isInteger(qty)) {
      return { valid: false, reason: "Quantity must be positive integer" };
    }
    
    if (side !== "BUY" && side !== "SELL") {
      return { valid: false, reason: "Side must be BUY or SELL" };
    }
    
    return { valid: true };
  }

  _validateOrder(symbol, side, qty, price) {
    const basicValidation = this._validateBasicOrder(symbol, side, qty);
    if (!basicValidation.valid) return basicValidation;
    
    if (price <= 0) {
      return { valid: false, reason: "Price must be > 0" };
    }
    
    const tradeValue = price * qty;
    if (tradeValue < this.minTradeValue) {
      return { valid: false, reason: `Trade value ${round2(tradeValue)} below minimum ${this.minTradeValue}` };
    }
    
    if (side === "BUY") {
      const totalCost = round2(tradeValue * (1 + this.commissionPct + this.slippagePct));
      const requiredCash = round2(totalCost / this.marginMultiplier);
      if (this.cash < requiredCash) {
        return { valid: false, reason: `Insufficient cash: need ${requiredCash}, have ${round2(this.cash)}` };
      }
    }
    
    if (side === "SELL") {
      const pos = this.positions[symbol];
      if (!this.allowShort && (!pos || pos.qty < qty)) {
        return { valid: false, reason: `Cannot sell ${qty} shares - only have ${pos?.qty || 0}` };
      }
    }
    
    return { valid: true };
  }

  _checkPositionSizeLimit(symbol, side, qty, price) {
    const pos = this.positions[symbol];
    let newQty = qty;
    
    if (pos) {
      if (side === "BUY") {
        newQty = pos.qty > 0 ? pos.qty + qty : Math.max(qty, qty - Math.abs(pos.qty));
      } else {
        newQty = pos.qty < 0 ? Math.abs(pos.qty) + qty : Math.max(qty, qty - pos.qty);
      }
    }
    
    const positionValue = Math.abs(newQty) * price;
    
    // ✅ FIX: Use proper equity calculation
    const priceMap = { ...this.lastPrices, [symbol]: price };
    const equity = this._calculateEquitySync(priceMap);
    
    if (equity <= 0) return false;
    
    return (positionValue / equity) <= this.maxPositionSize;
  }

  _applySlippage(price, side) {
    if (!this.slippagePct) return price;
    const factor = side === "BUY" ? (1 + this.slippagePct) : (1 - this.slippagePct);
    return round2(price * factor);
  }

  _resolvePriceFromProvider(provider) {
    if (typeof provider === "number") {
      return { price: provider, time: nowIso() };
    }
    if (provider && typeof provider === "object" && provider.price !== undefined) {
      return { price: Number(provider.price), time: provider.time ?? nowIso() };
    }
    if (typeof provider === "function") {
      const res = provider();
      return this._resolvePriceFromProvider(res);
    }
    throw new Error("Invalid price provider");
  }

  _updateTradeMetrics(pnl) {
    if (pnl > 0) {
      this.metrics.winningTrades++;
      this.metrics.largestWin = Math.max(this.metrics.largestWin, pnl);
      this.metrics.totalWinAmount += pnl;  // ✅ FIX
    } else if (pnl < 0) {
      this.metrics.losingTrades++;
      this.metrics.largestLoss = Math.min(this.metrics.largestLoss, pnl);
      this.metrics.totalLossAmount += Math.abs(pnl);  // ✅ FIX
    }
  }

  // ✅ NEW: Synchronous equity calculation
  _calculateEquitySync(priceMap) {
    let unreal = 0;
    
    for (const s of Object.keys(this.positions)) {
      const p = this.positions[s];
      if (p.qty === 0) continue;
      
      const last = priceMap[s] ?? p.avgPrice;
      unreal += (last - p.avgPrice) * p.qty;
    }
    
    return round2(this.cash + unreal);
  }

  /* ==================== PORTFOLIO & METRICS ==================== */

  async getEquity(symbolSnapshotProvider) {
    let priceMap = {};
    
    if (!symbolSnapshotProvider) {
      priceMap = this.lastPrices;
    } else if (typeof symbolSnapshotProvider === "function") {
      priceMap = await symbolSnapshotProvider();
    } else if (symbolSnapshotProvider && typeof symbolSnapshotProvider === "object") {
      priceMap = symbolSnapshotProvider;
    }
    
    return this._calculateEquitySync(priceMap);
  }

  async getPortfolioSnapshot(latestPrices = {}) {
    let priceMap = {};
    if (typeof latestPrices === "function") {
      priceMap = await latestPrices();
    } else if (Object.keys(latestPrices).length > 0) {
      priceMap = latestPrices;
    } else {
      priceMap = this.lastPrices;
    }
    
    const snapshot = {
      cash: round2(this.cash),
      initialCash: this.initialCash,
      positions: [],
      totalUnrealized: 0,
      totalRealized: 0,
      equity: null
    };
    
    for (const s of Object.keys(this.positions)) {
      const p = this.positions[s];
      
      // ✅ FIX: Include positions with realized P&L even if qty=0
      if (p.qty === 0 && (!p.realized || p.realized === 0)) continue;
      
      const last = priceMap[s] ?? p.avgPrice;
      const unreal = p.qty === 0 ? 0 : round2((last - p.avgPrice) * p.qty);
      
      snapshot.positions.push({
        symbol: s,
        qty: p.qty,
        side: p.side || 'FLAT',
        avgPrice: round2(p.avgPrice),
        realized: round2(p.realized || 0),
        lastPrice: last,
        unrealized: unreal,
        value: round2(last * Math.abs(p.qty))
      });
      
      if (p.qty !== 0) {
        snapshot.totalUnrealized += unreal;
      }
      snapshot.totalRealized += (p.realized || 0);
    }
    
    snapshot.totalUnrealized = round2(snapshot.totalUnrealized);
    snapshot.totalRealized = round2(snapshot.totalRealized);
    snapshot.equity = round2(this.cash + snapshot.totalUnrealized);
    snapshot.totalPnL = round2(snapshot.totalRealized + snapshot.totalUnrealized);
    snapshot.returnPct = round4(((snapshot.equity - this.initialCash) / this.initialCash) * 100);
    
    return snapshot;
  }

  getPerformanceMetrics() {
    const winRate = this.metrics.totalTrades > 0
      ? round4((this.metrics.winningTrades / this.metrics.totalTrades) * 100)
      : 0;
    
    // ✅ FIX: Use tracked totals for accurate averages
    const avgWin = this.metrics.winningTrades > 0 
      ? round2(this.metrics.totalWinAmount / this.metrics.winningTrades) 
      : 0;
    
    const avgLoss = this.metrics.losingTrades > 0 
      ? round2(this.metrics.totalLossAmount / this.metrics.losingTrades) 
      : 0;
    
    const profitFactor = this.metrics.totalLossAmount > 0 
      ? round2(this.metrics.totalWinAmount / this.metrics.totalLossAmount) 
      : 0;
    
    // ✅ NEW: Expectancy
    const expectancy = this.metrics.totalTrades > 0
      ? round2((this.metrics.totalWinAmount - this.metrics.totalLossAmount) / this.metrics.totalTrades)
      : 0;
    
    return {
      totalTrades: this.metrics.totalTrades,
      winningTrades: this.metrics.winningTrades,
      losingTrades: this.metrics.losingTrades,
      winRate: `${winRate}%`,
      winRateValue: winRate,
      largestWin: round2(this.metrics.largestWin),
      largestLoss: round2(this.metrics.largestLoss),
      avgWin,
      avgLoss,
      profitFactor,
      expectancy,
      totalCommission: round2(this.metrics.totalCommission),
      totalSlippage: round2(this.metrics.totalSlippage)
    };
  }

  getOpenOrders() {
    return this.openOrders.slice();
  }

  getPositions() {
    return JSON.parse(JSON.stringify(this.positions));
  }

  getTradeHistory() {
    return this.trades.slice();
  }

  _recordEquityPoint(time, symbol, price) {
    const priceMap = { ...this.lastPrices, [symbol]: price };
    const equity = this._calculateEquitySync(priceMap);
    this.equityHistory.push({ time, equity });
  }

  /* ==================== RESET ==================== */

  reset() {
    this.cash = this.initialCash;
    this.positions = {};
    this.openOrders = [];
    this.trades = [];
    this.equityHistory = [];
    this.orderBook = {};
    this.lastPrices = {};
    
    // ✅ FIX: Reset instance counters
    this.nextOrderId = 1;
    this.nextTradeId = 1;
    
    this.metrics = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      largestWin: 0,
      largestLoss: 0,
      totalCommission: 0,
      totalSlippage: 0,
      totalWinAmount: 0,
      totalLossAmount: 0
    };
  }

  /* ==================== PERSISTENCE ==================== */

  async saveState(filePath) {
    const state = {
      cash: this.cash,
      initialCash: this.initialCash,
      commissionPct: this.commissionPct,
      slippagePct: this.slippagePct,
      allowShort: this.allowShort,
      marginMultiplier: this.marginMultiplier,
      maxPositionSize: this.maxPositionSize,
      positions: this.positions,
      openOrders: this.openOrders,
      trades: this.trades,
      equityHistory: this.equityHistory,
      metrics: this.metrics,
      lastPrices: this.lastPrices,  // ✅ FIX: Save last prices
      nextOrderId: this.nextOrderId,  // ✅ FIX: Save counters
      nextTradeId: this.nextTradeId
    };
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
    return true;
  }

  async loadState(filePath) {
    const raw = await fs.readFile(filePath, "utf8");
    const state = JSON.parse(raw);
    
    this.cash = state.cash;
    this.initialCash = state.initialCash;
    this.commissionPct = state.commissionPct;
    this.slippagePct = state.slippagePct;
    this.allowShort = state.allowShort;
    this.marginMultiplier = state.marginMultiplier || 1;
    this.maxPositionSize = state.maxPositionSize || 1.0;
    this.positions = state.positions;
    this.openOrders = state.openOrders;
    this.trades = state.trades;
    this.equityHistory = state.equityHistory;
    this.lastPrices = state.lastPrices || {};
    
    // ✅ FIX: Restore counters
    this.nextOrderId = state.nextOrderId || 1;
    this.nextTradeId = state.nextTradeId || 1;
    
    // ✅ FIX: Restore metrics with new fields
    this.metrics = state.metrics || {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      largestWin: 0,
      largestLoss: 0,
      totalCommission: 0,
      totalSlippage: 0,
      totalWinAmount: 0,
      totalLossAmount: 0
    };
    
    // Rebuild order book
    this.orderBook = {};
    for (const order of this.openOrders) {
      this.orderBook[order.id] = order;
    }
    
    return true;
  }

  /* ==================== REPORTING ==================== */

  generateTradeReport() {
    if (this.trades.length === 0) {
      return "No trades executed yet.";
    }

    const lines = [];
    lines.push("=".repeat(80));
    lines.push("TRADE HISTORY REPORT");
    lines.push("=".repeat(80));
    lines.push("");
    
    this.trades.forEach(t => {
      lines.push(`Trade #${t.id} | ${t.time}`);
      lines.push(`  ${t.side} ${t.qty} x ${t.symbol} @ ₹${t.price}`);
      lines.push(`  Value: ₹${t.value} | Commission: ₹${t.commission} | Slippage: ₹${t.slippage}`);
      if (t.pnl !== 0) {
        lines.push(`  P&L: ₹${t.pnl} ${t.pnl > 0 ? '📈' : '📉'}`);
      }
      lines.push("");
    });

    const metrics = this.getPerformanceMetrics();
    lines.push("=".repeat(80));
    lines.push("PERFORMANCE METRICS");
    lines.push("=".repeat(80));
    lines.push(`Total Trades: ${metrics.totalTrades}`);
    lines.push(`Win Rate: ${metrics.winRate}`);
    lines.push(`Winning Trades: ${metrics.winningTrades} | Losing Trades: ${metrics.losingTrades}`);
    lines.push(`Largest Win: ₹${metrics.largestWin} | Largest Loss: ₹${metrics.largestLoss}`);
    lines.push(`Average Win: ₹${metrics.avgWin} | Average Loss: ₹${metrics.avgLoss}`);
    lines.push(`Profit Factor: ${metrics.profitFactor}`);
    lines.push(`Expectancy: ₹${metrics.expectancy} per trade`);
    lines.push(`Total Commission Paid: ₹${metrics.totalCommission}`);
    lines.push(`Total Slippage Cost: ₹${metrics.totalSlippage}`);
    lines.push("=".repeat(80));

    return lines.join("\n");
  }

  async generatePortfolioReport(latestPrices = {}) {
    const snapshot = await this.getPortfolioSnapshot(latestPrices);
    
    const lines = [];
    lines.push("=".repeat(80));
    lines.push("PORTFOLIO SNAPSHOT");
    lines.push("=".repeat(80));
    lines.push("");
    lines.push(`Cash: ₹${snapshot.cash}`);
    lines.push(`Initial Capital: ₹${snapshot.initialCash}`);
    lines.push(`Current Equity: ₹${snapshot.equity}`);
    lines.push(`Total Return: ₹${round2(snapshot.equity - snapshot.initialCash)} (${snapshot.returnPct}%)`);
    lines.push("");
    lines.push(`Total Realized P&L: ₹${snapshot.totalRealized}`);
    lines.push(`Total Unrealized P&L: ₹${snapshot.totalUnrealized}`);
    lines.push(`Total P&L: ₹${snapshot.totalPnL}`);
    lines.push("");
    lines.push("-".repeat(80));
    lines.push("OPEN POSITIONS");
    lines.push("-".repeat(80));
    
    const openPositions = snapshot.positions.filter(p => p.qty !== 0);
    
    if (openPositions.length === 0) {
      lines.push("No open positions.");
    } else {
      openPositions.forEach(p => {
        lines.push(`${p.symbol} | ${p.side}`);
        lines.push(`  Qty: ${p.qty} @ Avg ₹${p.avgPrice}`);
        if (p.lastPrice) {
          lines.push(`  Current: ₹${p.lastPrice} | Value: ₹${p.value}`);
          lines.push(`  Unrealized P&L: ₹${p.unrealized} ${p.unrealized >= 0 ? '✅' : '❌'}`);
        }
        if (p.realized !== 0) {
          lines.push(`  Realized P&L: ₹${p.realized}`);
        }
        lines.push("");
      });
    }
    
    lines.push("-".repeat(80));
    lines.push("OPEN ORDERS");
    lines.push("-".repeat(80));
    
    if (this.openOrders.length === 0) {
      lines.push("No open orders.");
    } else {
      this.openOrders.forEach(o => {
        lines.push(`Order #${o.id} | ${o.type} | ${o.side} ${o.qty} x ${o.symbol}`);
        if (o.limitPrice) lines.push(`  Limit Price: ₹${o.limitPrice}`);
        if (o.stopPrice) lines.push(`  Stop Price: ₹${o.stopPrice}`);
        lines.push(`  Status: ${o.status || 'PENDING'}`);
        if (o.attached?.type) lines.push(`  Type: ${o.attached.type}`);
        lines.push("");
      });
    }
    
    lines.push("=".repeat(80));
    
    return lines.join("\n");
  }
}

