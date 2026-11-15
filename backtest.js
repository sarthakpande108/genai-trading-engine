/**
 * Long-only cash-account backtester. Signals are evaluated at close and
 * executed at the next bar open. Buys that exceed available cash are skipped.
 */
function validPositive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`);
}
export function runBacktest({ bars, signals, initialCapital = 100_000, quantity = 1, feeBps = 5, slippageBps = 2 }) {
  if (!Array.isArray(bars) || !Array.isArray(signals) || bars.length !== signals.length) throw new TypeError("bars and signals must be arrays of equal length");
  validPositive(initialCapital, "initialCapital");
  validPositive(quantity, "quantity");
  if (![feeBps, slippageBps].every((v) => Number.isFinite(v) && v >= 0)) throw new RangeError("feeBps and slippageBps must be non-negative");
  bars.forEach((bar, i) => {
    if (!bar || !Number.isFinite(bar.open) || !Number.isFinite(bar.close) || bar.open <= 0 || bar.close <= 0) throw new TypeError(`bar ${i} must contain positive finite open and close prices`);
    if (![0, 1].includes(signals[i])) throw new RangeError(`signal ${i} must be 0 (flat) or 1 (long)`);
  });
  let cash=initialCapital, position=0, entryPrice=null, entryIndex=null;
  const trades=[], skippedOrders=[], equityCurve=[];
  const execute=(target,index)=>{
    if(target===position || index>=bars.length) return;
    const raw=bars[index].open, direction=target>position?1:-1;
    const price=raw*(1+direction*slippageBps/10_000), delta=(target-position)*quantity;
    const notional=Math.abs(delta*price), fee=notional*feeBps/10_000;
    if(target===1 && notional+fee>cash){
      skippedOrders.push({index,side:"BUY",quantity,requiredCash:notional+fee,availableCash:cash,reason:"INSUFFICIENT_CASH"});
      return;
    }
    cash-=delta*price+fee;
    if(target===1){entryPrice=price;entryIndex=index;}
    else{
      const pnl=(price-entryPrice)*quantity-(entryPrice*quantity+price*quantity)*feeBps/10_000;
      trades.push({entryIndex,exitIndex:index,entryPrice,exitPrice:price,quantity,pnl});
      entryPrice=null;entryIndex=null;
    }
    position=target;
  };
  for(let i=0;i<bars.length;i+=1){
    if(i>0) execute(signals[i-1],i);
    equityCurve.push({index:i,equity:cash+position*quantity*bars[i].close,cash});
  }
  if(position===1 && bars.length){
    const raw=bars.at(-1).close, price=raw*(1-slippageBps/10_000), fee=quantity*price*feeBps/10_000;
    cash+=quantity*price-fee;
    const pnl=(price-entryPrice)*quantity-(entryPrice*quantity+price*quantity)*feeBps/10_000;
    trades.push({entryIndex,exitIndex:bars.length-1,entryPrice,exitPrice:price,quantity,pnl});
    position=0; equityCurve[equityCurve.length-1]={index:bars.length-1,equity:cash,cash};
  }
  let peak=initialCapital,maxDrawdown=0;
  for(const point of equityCurve){peak=Math.max(peak,point.equity);if(peak>0)maxDrawdown=Math.max(maxDrawdown,(peak-point.equity)/peak);}
  const finalEquity=equityCurve.at(-1)?.equity??initialCapital;
  return {initialCapital,finalEquity,totalReturn:finalEquity/initialCapital-1,maxDrawdown,tradeCount:trades.length,trades,skippedOrders,equityCurve,assumptions:{execution:"next_bar_open",positionMode:"long_only_cash_account",quantity,feeBps,slippageBps}};
}
