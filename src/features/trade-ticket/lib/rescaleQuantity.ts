interface Levels {
  entry: number;
  stopLoss: number;
}

/**
 * Пересчитывает объём под новые вход и стоп так, чтобы риск в долларах остался прежним,
 * но объём позиции не превысил исходный (он уже учитывал лимит на сделку).
 */
export function rescaleQuantity(
  quantity: number,
  before: Levels,
  after: Levels,
): number {
  const riskUsd = quantity * Math.abs(before.entry - before.stopLoss);
  const riskPerUnit = Math.abs(after.entry - after.stopLoss);
  if (riskPerUnit <= 0) return quantity;
  const notionalCap = quantity * before.entry;
  return Math.min(riskUsd / riskPerUnit, notionalCap / after.entry);
}
