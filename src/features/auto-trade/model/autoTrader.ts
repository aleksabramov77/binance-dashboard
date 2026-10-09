import type { AutoTradeState } from "@/entities/trade";
import { log } from "@/shared/lib/logger.server";
import { AUTO_TRADE } from "../config/autoTrade";
import { type AutoTradeDeps, runAutoTradeCycle } from "./runCycle";
import { loadState, saveState } from "./stateStore";

interface Trader {
  deps: AutoTradeDeps;
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
}

// Один цикл и одна очередь записи на процесс: в dev instrumentation и роуты собираются
// разными бандлами, поэтому таймер и блокировка живут в globalThis, а не в переменных модуля.
const traderKey = Symbol.for("binance-dashboard.autoTrader");
const lockKey = Symbol.for("binance-dashboard.autoTrader.stateLock");
type GlobalWithTrader = typeof globalThis & {
  [traderKey]?: Trader;
  [lockKey]?: Promise<unknown>;
};
const g = globalThis as GlobalWithTrader;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * Чтение→изменение→запись файла состояния без гонок: тоггл из роута и конец цикла
 * не перетирают друг друга (иначе «выкл» мог бы вернуться в «вкл»).
 */
function updateState(
  change: (state: AutoTradeState) => AutoTradeState,
): Promise<AutoTradeState> {
  const run = (g[lockKey] ?? Promise.resolve()).then(async () => {
    const next = change(await loadState());
    await saveState(next);
    return next;
  });
  g[lockKey] = run.catch(() => {});
  return run;
}

function schedule(trader: Trader, delayMs: number) {
  if (trader.timer) clearTimeout(trader.timer);
  trader.timer = setTimeout(() => void tick(trader), delayMs);
  // Таймер не должен держать процесс (тесты, остановка сервера).
  trader.timer.unref?.();
}

async function tick(trader: Trader): Promise<void> {
  if (trader.running) return trader.running;
  trader.running = (async () => {
    // Состояние читаем каждый раз: переключатель могли изменить из роута.
    const state = await loadState();
    if (!state.enabled) return;
    try {
      const result = await runAutoTradeCycle(state, trader.deps, async () => {
        // Перед каждой сделкой: выключили посреди цикла — больше не входим.
        await g[lockKey];
        return (await loadState()).enabled;
      });
      // enabled/enabledAt не трогаем — их меняет только переключатель.
      await updateState((current) => ({ ...current, ...result }));
    } catch (error) {
      log.error("auto.cycle", "Автоцикл не выполнен", undefined, error);
      await updateState((current) => ({
        ...current,
        lastCycleAt: new Date().toISOString(),
        lastError: errorText(error),
      }));
    }
  })()
    .catch((error) =>
      log.error("auto.cycle", "Сбой автоторговли", undefined, error),
    )
    .finally(() => {
      trader.running = null;
      schedule(trader, AUTO_TRADE.intervalMs);
    });
  return trader.running;
}

/** Запускает фоновый цикл (один раз на процесс). Повторный вызов обновляет зависимости. */
export function startAutoTrader(deps: AutoTradeDeps): void {
  const existing = g[traderKey];
  if (existing) {
    existing.deps = deps;
    return;
  }
  const trader: Trader = { deps, timer: null, running: null };
  g[traderKey] = trader;
  schedule(trader, AUTO_TRADE.firstRunDelayMs);
  log.info("auto.start", "Фоновый цикл автоторговли запущен", {
    intervalMs: AUTO_TRADE.intervalMs,
  });
}

export const getAutoTradeState = (): Promise<AutoTradeState> => loadState();

/** Включает/выключает автоторговлю. Включили — первый цикл сразу. */
export async function setAutoTradeEnabled(
  enabled: boolean,
  deps: AutoTradeDeps,
): Promise<AutoTradeState> {
  startAutoTrader(deps);
  const next = await updateState((state) => ({
    ...state,
    enabled,
    enabledAt: enabled
      ? state.enabled
        ? state.enabledAt
        : new Date().toISOString()
      : null,
  }));
  log.info(
    "auto.toggle",
    enabled ? "Автоторговля включена" : "Автоторговля выключена",
  );
  const trader = g[traderKey];
  if (enabled && trader && !trader.running) schedule(trader, 0);
  return next;
}
