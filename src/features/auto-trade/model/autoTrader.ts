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

// Один цикл на процесс: в dev instrumentation и роуты собираются разными бандлами,
// поэтому таймер живёт в globalThis, а не в переменной модуля.
const globalKey = Symbol.for("binance-dashboard.autoTrader");
type GlobalWithTrader = typeof globalThis & { [globalKey]?: Trader };
const g = globalThis as GlobalWithTrader;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
    if (state.enabled) {
      try {
        const next = await runAutoTradeCycle(state, trader.deps);
        // Пока шёл цикл, торговлю могли выключить — флаг берём свежий.
        const current = await loadState();
        await saveState({
          ...next,
          enabled: current.enabled,
          enabledAt: current.enabledAt,
        });
      } catch (error) {
        log.error("auto.cycle", "Автоцикл не выполнен", undefined, error);
        const current = await loadState();
        await saveState({
          ...current,
          lastCycleAt: new Date().toISOString(),
          lastError: errorText(error),
        });
      }
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
  const existing = g[globalKey];
  if (existing) {
    existing.deps = deps;
    return;
  }
  const trader: Trader = { deps, timer: null, running: null };
  g[globalKey] = trader;
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
  const state = await loadState();
  const next: AutoTradeState = {
    ...state,
    enabled,
    enabledAt: enabled
      ? state.enabled
        ? state.enabledAt
        : new Date().toISOString()
      : null,
  };
  await saveState(next);
  log.info(
    "auto.toggle",
    enabled ? "Автоторговля включена" : "Автоторговля выключена",
  );
  const trader = g[globalKey];
  if (enabled && trader && !trader.running) schedule(trader, 0);
  return next;
}
