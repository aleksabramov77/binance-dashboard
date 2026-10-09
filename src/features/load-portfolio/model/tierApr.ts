/**
 * Binance отдаёт бонусные ступени позиции как { "0-5BTC": 0.05, "5-10BTC": 0.03 }.
 * Возвращает итоговую ставку на сумму `amount` с учётом этих ступеней.
 */
export function aprWithTiers(
  baseApr: number,
  tiers: Record<string, number> | null | undefined,
  amount: number,
) {
  if (!tiers || amount <= 0) return baseApr;
  let bonus = 0;
  for (const [range, ratio] of Object.entries(tiers)) {
    const match = /^([\d.]+)-([\d.]+)/.exec(range);
    if (!match) continue;
    const from = Number(match[1]);
    const to = Number(match[2]);
    bonus += ratio * Math.max(0, Math.min(amount, to) - from);
  }
  return baseApr + bonus / amount;
}
