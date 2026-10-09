import type { ScanResult, Setup, SetupRecheck } from "@/entities/market-signal";
import type {
  AutoTradeAction,
  AutoTradeOutcome,
  AutoTradeState,
  TradeOverview,
  TradeRequest,
  TradeResult,
} from "@/entities/trade";
import { log } from "@/shared/lib/logger.server";
import { AUTO_TRADE } from "../config/autoTrade";
import { entryKey, planEntries } from "../lib/planEntries";
import { sizeAutoTrade } from "../lib/sizeAutoTrade";

/** Внешние действия цикла. Связывает их слой app: фича не импортирует другие фичи. */
export interface AutoTradeDeps {
  scan: () => Promise<ScanResult>;
  recheck: (setup: Setup) => Promise<SetupRecheck>;
  place: (request: TradeRequest) => Promise<TradeResult>;
  overview: () => Promise<TradeOverview>;
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const OUTCOME_BY_STATUS: Record<TradeResult["status"], AutoTradeOutcome> = {
  protected: "opened",
  unprotected: "unprotected",
  rejected: "rejected",
};

/**
 * Один цикл: скан → отбор → для каждого сетапа предпроверка по свежим свечам →
 * размер → сделка через placeTrade (там вся серверная валидация). Возвращает новое
 * состояние; сам ничего не сохраняет.
 */
export async function runAutoTradeCycle(
  state: AutoTradeState,
  deps: AutoTradeDeps,
  now = Date.now(),
): Promise<AutoTradeState> {
  const actions: AutoTradeAction[] = [];
  const entries = { ...state.entries };
  const record = (setup: Setup, outcome: AutoTradeOutcome, reason: string) =>
    actions.push({
      at: new Date().toISOString(),
      symbol: setup.symbol,
      market: setup.market,
      direction: setup.direction,
      setupStatus: setup.status,
      outcome,
      reason,
    });

  const [overview, scan] = await Promise.all([deps.overview(), deps.scan()]);
  if (!overview.configured)
    throw new Error("Ключ Demo Trading не настроен — автоторговля стоит.");
  if (!overview.balances || !overview.openSymbols)
    throw new Error(
      `Нет балансов или открытых позиций демо-счёта${overview.error ? `: ${overview.error}` : ""} — цикл пропущен.`,
    );

  const plan = planEntries(scan.setups, {
    now,
    openSymbols: overview.openSymbols,
    entries,
    limits: AUTO_TRADE,
  });
  for (const { setup, reason } of plan.skipped)
    record(setup, "skipped", reason);

  for (const setup of plan.take) {
    try {
      const recheck = await deps.recheck(setup);
      if (recheck.status === "stale" || !recheck.fresh) {
        record(
          setup,
          "skipped",
          `предпроверка: вход неактуален (${recheck.notes.join("; ") || recheck.status})`,
        );
        continue;
      }
      const fresh = recheck.fresh;
      const size = sizeAutoTrade(
        fresh,
        overview.balances[fresh.market],
        AUTO_TRADE,
      );
      if (!size) {
        record(setup, "skipped", "на демо-кошельке нет USDT или стоп нулевой");
        continue;
      }
      const result = await deps.place({
        symbol: fresh.symbol,
        market: fresh.market,
        direction: fresh.direction,
        quantity: size.quantity,
        stopLoss: fresh.stopLoss,
        takeProfit: fresh.takeProfit1,
        leverage: size.leverage,
        setupId: `auto:${fresh.id}`,
      });
      const outcome = OUTCOME_BY_STATUS[result.status];
      // Позиция могла открыться и без защиты — повторно в ту же пару не лезем.
      if (outcome !== "rejected") entries[entryKey(setup)] = result.at;
      record(setup, outcome, result.message);
    } catch (error) {
      record(setup, "error", errorText(error));
    }
  }

  const fresh = dedupeSkips(actions, state.actions);
  for (const a of fresh.filter((a) => a.outcome !== "skipped"))
    log.info(
      "auto.trade",
      `${a.symbol} ${a.direction}: ${a.outcome} — ${a.reason}`,
      a,
    );
  log.info(
    "auto.cycle",
    `Автоцикл: сетапов ${scan.setups.length}, входов ${plan.take.length}`,
    {
      setups: scan.setups.length,
      take: plan.take.map((s) => s.symbol),
      results: actions.filter((a) => a.outcome !== "skipped"),
    },
  );
  return {
    ...state,
    lastCycleAt: new Date().toISOString(),
    lastError: null,
    actions: [...fresh, ...state.actions].slice(0, AUTO_TRADE.actionsKept),
    entries: pruneEntries(entries, now),
  };
}

/**
 * Пропуски повторяются каждый цикл («уже в сделке»). В историю пишем пропуск, только если
 * у пары последнее решение было другим — иначе список зарастёт одинаковыми строками.
 */
export function dedupeSkips(
  next: AutoTradeAction[],
  previous: AutoTradeAction[],
): AutoTradeAction[] {
  const lastByKey = new Map<string, AutoTradeAction>();
  for (const a of [...previous].reverse()) lastByKey.set(entryKey(a), a);
  return next.filter((a) => {
    const last = lastByKey.get(entryKey(a));
    lastByKey.set(entryKey(a), a);
    return !(
      a.outcome === "skipped" &&
      last?.outcome === "skipped" &&
      last.reason === a.reason
    );
  });
}

/** Старые отметки входов больше не влияют на паузу — выбрасываем. */
function pruneEntries(
  entries: Record<string, string>,
  now: number,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter(
      ([, at]) => now - Date.parse(at) < AUTO_TRADE.cooldownMs,
    ),
  );
}
