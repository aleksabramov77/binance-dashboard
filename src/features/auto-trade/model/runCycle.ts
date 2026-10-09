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
 * Один цикл: скан → отбор → для каждого кандидата предпроверка по свежим свечам →
 * размер → сделка через placeTrade (там вся серверная валидация). Перед каждой сделкой
 * спрашивает isEnabled: выключили посреди цикла — новых входов нет. Возвращает
 * изменения состояния; сам ничего не сохраняет.
 */
export async function runAutoTradeCycle(
  state: AutoTradeState,
  deps: AutoTradeDeps,
  isEnabled: () => Promise<boolean> = async () => true,
  now = Date.now(),
): Promise<
  Pick<AutoTradeState, "lastCycleAt" | "lastError" | "actions" | "holds">
> {
  const actions: AutoTradeAction[] = [];
  const holds = { ...state.holds };
  const hold = (setup: Setup, ms: number) => {
    holds[entryKey(setup)] = new Date(now + ms).toISOString();
  };
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
    holds,
    setupStatuses: AUTO_TRADE.setupStatuses,
  });
  for (const { setup, reason } of plan.skipped)
    record(setup, "skipped", reason);

  let openCount =
    overview.openSymbols.spot.length + overview.openSymbols.futures.length;
  let placed = 0;
  let stopped = false;
  for (const setup of plan.candidates) {
    // Лимиты — по фактическим сделкам: отказы и неактуальные сетапы слоты не занимают.
    if (placed >= AUTO_TRADE.maxEntriesPerCycle) {
      record(setup, "skipped", "лимит входов за цикл — в следующем цикле");
      continue;
    }
    if (openCount >= AUTO_TRADE.maxOpenPositions) {
      record(setup, "skipped", `уже ${openCount} символов в сделке — лимит`);
      continue;
    }
    let fresh: Setup;
    try {
      const recheck = await deps.recheck(setup);
      if (recheck.status === "stale" || !recheck.fresh) {
        hold(setup, AUTO_TRADE.retryMs);
        record(
          setup,
          "skipped",
          `предпроверка: вход неактуален (${recheck.notes.join("; ") || recheck.status})`,
        );
        continue;
      }
      fresh = recheck.fresh;
    } catch (error) {
      // Ничего не отправлено — можно повторить в следующем цикле.
      record(setup, "error", `предпроверка: ${errorText(error)}`);
      continue;
    }
    const size = sizeAutoTrade(
      fresh,
      overview.balances[fresh.market],
      AUTO_TRADE,
    );
    if (!size) {
      hold(setup, AUTO_TRADE.retryMs);
      record(setup, "skipped", "на демо-кошельке нет USDT или стоп нулевой");
      continue;
    }
    if (!(await isEnabled())) {
      stopped = true;
      break;
    }
    placed += 1;
    try {
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
      if (outcome === "rejected") hold(setup, AUTO_TRADE.retryMs);
      else {
        // Позиция открыта (возможно, без защиты) — в ту же пару долго не лезем.
        hold(setup, AUTO_TRADE.cooldownMs);
        openCount += 1;
      }
      record(setup, outcome, result.message);
    } catch (error) {
      // Сбой посреди сделки: позиция могла открыться — длинная пауза, как после входа.
      hold(setup, AUTO_TRADE.cooldownMs);
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
    `Автоцикл: сетапов ${scan.setups.length}, сделок отправлено ${placed}${stopped ? " (выключено посреди цикла)" : ""}`,
    {
      setups: scan.setups.length,
      placed,
      stopped,
      results: actions.filter((a) => a.outcome !== "skipped"),
    },
  );
  return {
    lastCycleAt: new Date().toISOString(),
    lastError: null,
    actions: [...fresh, ...state.actions].slice(0, AUTO_TRADE.actionsKept),
    holds: pruneHolds(holds, now),
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

/** Истёкшие паузы больше ни на что не влияют — выбрасываем. */
function pruneHolds(
  holds: Record<string, string>,
  now: number,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(holds).filter(([, until]) => Date.parse(until) > now),
  );
}
