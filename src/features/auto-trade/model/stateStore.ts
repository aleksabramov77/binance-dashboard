import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AutoTradeState, autoTradeStateSchema } from "@/entities/trade";
import { log } from "@/shared/lib/logger.server";
import { AUTO_TRADE } from "../config/autoTrade";

/** Состояние в файле: переключатель переживает перезапуск сервера. data/ — не в git. */
const STATE_FILE =
  process.env.AUTO_TRADE_STATE_FILE ??
  path.join(process.cwd(), "data", "auto-trade.json");

export const emptyState = (): AutoTradeState => ({
  enabled: false,
  enabledAt: null,
  lastCycleAt: null,
  lastError: null,
  intervalMs: AUTO_TRADE.intervalMs,
  actions: [],
  holds: {},
});

export async function loadState(): Promise<AutoTradeState> {
  const raw = await readFile(STATE_FILE, "utf8").catch(() => null);
  if (raw === null) return emptyState();
  try {
    const parsed = autoTradeStateSchema.parse(JSON.parse(raw));
    return { ...parsed, intervalMs: AUTO_TRADE.intervalMs };
  } catch (error) {
    // Битый файл не должен включать торговлю — начинаем с выключенной.
    log.error(
      "auto.state",
      "Файл состояния автоторговли не читается",
      {
        file: STATE_FILE,
      },
      error,
    );
    return emptyState();
  }
}

export async function saveState(state: AutoTradeState): Promise<void> {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  // Своё имя tmp на каждую запись: параллельные записи не портят один и тот же файл.
  const tmp = `${STATE_FILE}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tmp, STATE_FILE);
}
