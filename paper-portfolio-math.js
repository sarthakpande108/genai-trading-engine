function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(name + " must be positive and finite");
  }
}

function nonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(name + " must be non-negative and finite");
  }
}

/** Weighted-average entry cost including the buy-side fee. */
export function calculateAverageCost({
  existingQuantity = 0,
  existingAverageCost = 0,
  fillQuantity,
  fillPrice,
  feeBps = 5,
} = {}) {
  nonNegative(existingQuantity, "existingQuantity");
  if (existingQuantity > 0) positive(existingAverageCost, "existingAverageCost");
  else nonNegative(existingAverageCost, "existingAverageCost");
  positive(fillQuantity, "fillQuantity");
  positive(fillPrice, "fillPrice");
  nonNegative(feeBps, "feeBps");

  const oldCost = existingQuantity * existingAverageCost;
  const fillCost = fillQuantity * fillPrice * (1 + feeBps / 10_000);
  return (oldCost + fillCost) / (existingQuantity + fillQuantity);
}

/** Realized P&L for a long-only sell, net of the sell-side fee. */
export function calculateSellRealizedPnl({
  quantity,
  averageCost,
  fillPrice,
  feeBps = 5,
} = {}) {
  positive(quantity, "quantity");
  positive(averageCost, "averageCost");
  positive(fillPrice, "fillPrice");
  nonNegative(feeBps, "feeBps");

  const grossPnl = (fillPrice - averageCost) * quantity;
  const sellFee = quantity * fillPrice * feeBps / 10_000;
  return grossPnl - sellFee;
}

/** Value every open position using an explicit, positive mark for each symbol. */
export function calculatePortfolioValuation({ cash, positions, prices } = {}) {
  nonNegative(cash, "cash");
  if (!Array.isArray(positions)) throw new TypeError("positions must be an array");
  if (!prices || typeof prices !== "object" || Array.isArray(prices)) {
    throw new TypeError("prices map is required");
  }

  const normalizedPrices = Object.fromEntries(
    Object.entries(prices).map(([symbol, price]) => [symbol.trim().toUpperCase(), price])
  );
  let marketValue = 0;
  let unrealizedPnl = 0;

  for (const position of positions) {
    if (typeof position.symbol !== "string" || !position.symbol.trim()) {
      throw new TypeError("position symbol is required");
    }
    const quantity = Number(position.quantity);
    const averageCost = Number(position.average_cost ?? position.averageCost);
    const symbol = position.symbol.trim().toUpperCase();
    const price = Number(normalizedPrices[symbol]);
    positive(quantity, "quantity for " + symbol);
    positive(averageCost, "average cost for " + symbol);
    positive(price, "mark price for " + symbol);

    marketValue += quantity * price;
    unrealizedPnl += quantity * (price - averageCost);
    normalizedPrices[symbol] = price;
  }

  return {
    cash,
    marketValue,
    equity: cash + marketValue,
    unrealizedPnl,
    normalizedPrices: Object.fromEntries(
      positions.map((position) => {
        const symbol = position.symbol.trim().toUpperCase();
        return [symbol, normalizedPrices[symbol]];
      })
    ),
  };
}
