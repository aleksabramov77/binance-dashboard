import type { Setup } from "@/entities/market-signal";

export interface PlanContext {
  now: number;
  /** Символы с открытой позицией или ордерами на демо. */
  openSymbols: { spot: string[]; futures: string[] };
  /** «SYMBOL:direction» → до какого времени (ISO) не входить. */
  holds: Record<string, string>;
  setupStatuses: readonly Setup["status"][];
}

export interface PlannedSkip {
  setup: Setup;
  reason: string;
}

export const entryKey = (s: Pick<Setup, "symbol" | "direction">) =>
  `${s.symbol}:${s.direction}`;

/**
 * Кандидаты на вход в этом цикле. Порядок сетапов сохраняется (сканер ставит ready
 * и сильные выше): лимиты входов считает цикл по фактическим сделкам, первыми идут лучшие.
 */
export function planEntries(
  setups: Setup[],
  ctx: PlanContext,
): { candidates: Setup[]; skipped: PlannedSkip[] } {
  const candidates: Setup[] = [];
  const skipped: PlannedSkip[] = [];
  const taken = {
    spot: new Set(ctx.openSymbols.spot),
    futures: new Set(ctx.openSymbols.futures),
  };

  for (const setup of setups) {
    const skip = (reason: string) => skipped.push({ setup, reason });
    if (!ctx.setupStatuses.includes(setup.status)) {
      skip(`статус сетапа «${setup.status}» не берём`);
      continue;
    }
    if (setup.demoTradable === false) {
      skip("пары нет в Binance Demo");
      continue;
    }
    if (taken[setup.market].has(setup.symbol)) {
      skip("по символу уже есть позиция или ордера");
      continue;
    }
    const until = ctx.holds[entryKey(setup)];
    if (until && Date.parse(until) > ctx.now) {
      skip("пауза после прошлой попытки");
      continue;
    }
    candidates.push(setup);
    // Два сетапа на один символ (лонг и шорт) за цикл — только первый.
    taken[setup.market].add(setup.symbol);
  }
  return { candidates, skipped };
}
