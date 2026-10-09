import type { Setup } from "@/entities/market-signal";

export interface PlanContext {
  now: number;
  /** Символы с открытой позицией или ордерами на демо. */
  openSymbols: { spot: string[]; futures: string[] };
  /** «SYMBOL:direction» → время последнего автовхода (ISO). */
  entries: Record<string, string>;
  limits: {
    setupStatuses: readonly Setup["status"][];
    cooldownMs: number;
    maxOpenPositions: number;
    maxEntriesPerCycle: number;
  };
}

export interface PlannedSkip {
  setup: Setup;
  reason: string;
}

export const entryKey = (s: Pick<Setup, "symbol" | "direction">) =>
  `${s.symbol}:${s.direction}`;

/**
 * Какие сетапы брать в этом цикле. Порядок сетапов сохраняется (сканер ставит ready
 * и сильные выше), поэтому при лимитах первыми входим в лучшие.
 */
export function planEntries(
  setups: Setup[],
  ctx: PlanContext,
): { take: Setup[]; skipped: PlannedSkip[] } {
  const take: Setup[] = [];
  const skipped: PlannedSkip[] = [];
  const open = {
    spot: new Set(ctx.openSymbols.spot),
    futures: new Set(ctx.openSymbols.futures),
  };
  let openCount = open.spot.size + open.futures.size;

  for (const setup of setups) {
    const skip = (reason: string) => skipped.push({ setup, reason });
    if (!ctx.limits.setupStatuses.includes(setup.status)) {
      skip(`статус сетапа «${setup.status}» не берём`);
      continue;
    }
    if (setup.demoTradable === false) {
      skip("пары нет в Binance Demo");
      continue;
    }
    if (open[setup.market].has(setup.symbol)) {
      skip("по символу уже есть позиция или ордера");
      continue;
    }
    const last = ctx.entries[entryKey(setup)];
    if (last && ctx.now - Date.parse(last) < ctx.limits.cooldownMs) {
      skip("пауза после прошлого автовхода");
      continue;
    }
    if (take.length >= ctx.limits.maxEntriesPerCycle) {
      skip("лимит входов за цикл — в следующем цикле");
      continue;
    }
    if (openCount >= ctx.limits.maxOpenPositions) {
      skip(`уже ${openCount} символов в сделке — лимит`);
      continue;
    }
    take.push(setup);
    open[setup.market].add(setup.symbol);
    openCount += 1;
  }
  return { take, skipped };
}
