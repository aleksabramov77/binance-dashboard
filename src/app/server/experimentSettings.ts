// Композиция /settings лаборатории (spec 003, задача 3d): сброс тестовых капиталов (новая эпоха),
// стартовый бюджет следующей эпохи, вкл/выкл экспериментов. Только сервер.
import {
  budgetFormSchema,
  createDbExperimentStore,
  DEFAULT_INITIAL_BUDGET,
  getEpoch,
  type LabSettings,
  type ResetRequest,
  type ResetResult,
  resetRun,
  setExperimentEnabled,
} from "@/entities/experiment";
import { ENGINE_KEYS, planReset, priceKey } from "@/features/paper-engine";
import { fetch24hTickers } from "@/shared/api/binance/public.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { ensureEngineReady, withTickLock } from "./experimentEngine";

/** Бюджет следующей эпохи из engine_state; нет или мусор — по умолчанию. */
async function readNextBudget(
  store: ReturnType<typeof createDbExperimentStore>,
): Promise<number> {
  const parsed = budgetFormSchema.shape.initialBudget.safeParse(
    await store.getState(ENGINE_KEYS.nextBudget),
  );
  return parsed.success ? parsed.data : DEFAULT_INITIAL_BUDGET;
}

export async function getLabSettings(): Promise<LabSettings> {
  await ensureEngineReady();
  const db = getDb();
  const store = createDbExperimentStore(db);
  const experiments = await store.listExperiments();
  const epoch = await getEpoch(db, await store.currentRunId());
  return {
    epoch,
    currentBudget: Math.max(0, ...experiments.map((e) => e.initialBudget)),
    nextBudget: await readNextBudget(store),
    experiments: experiments.map((e) => ({
      id: e.id,
      market: e.market,
      name: e.name,
      hypothesis: e.hypothesis,
      enabled: e.enabled,
      demoMirror: e.demoMirror,
      initialBudget: e.initialBudget,
    })),
  };
}

/** Бюджет следующей эпохи: хранится в engine_state.next_budget, к экспериментам — при сбросе. */
export async function setNextBudget(
  initialBudget: number,
): Promise<LabSettings> {
  await ensureEngineReady();
  await createDbExperimentStore(getDb()).setState(
    ENGINE_KEYS.nextBudget,
    initialBudget,
  );
  log.info("experiments.budget", `Бюджет следующей эпохи: $${initialBudget}`);
  return getLabSettings();
}

/** Вкл/выкл эксперимента; null — эксперимента нет. Движок не входит в сделки выключенного. */
export async function toggleExperiment(
  id: string,
  enabled: boolean,
): Promise<LabSettings | null> {
  await ensureEngineReady();
  if (!(await setExperimentEnabled(getDb(), id, enabled))) return null;
  log.info("experiments.toggle", `${id} ${enabled ? "включён" : "выключен"}`);
  return getLabSettings();
}

/** Последние цены по рынкам открытых сделок; рынок не ответил — его сделки закроются без цены. */
async function lastPrices(
  markets: Set<"spot" | "futures">,
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    [...markets].map(async (market) => {
      try {
        for (const t of await fetch24hTickers(market))
          prices[priceKey(market, t.symbol)] = t.lastPrice;
      } catch (error) {
        log.warn(
          "experiments.reset",
          `Цены ${market} не получены — сделки закроются по цене входа`,
          { error: error instanceof Error ? error.message : String(error) },
        );
      }
    }),
  );
  return prices;
}

/**
 * «Сбросить тестовые капиталы»: под блокировкой тика закрыть открытые сделки текущей эпохи по
 * последней цене (manual), начать новую эпоху с бюджетом next_budget и пометить текущие свечи
 * обработанными. Тумблер движка не меняется. fromRunId уже не текущая — ничего не делает.
 */
export function resetCapitals(input: ResetRequest): Promise<ResetResult> {
  return withTickLock(async () => {
    await ensureEngineReady();
    const db = getDb();
    const store = createDbExperimentStore(db);
    const runId = await store.currentRunId();
    if (runId !== input.fromRunId)
      return {
        created: false,
        epoch: await getEpoch(db, runId),
        closed: 0,
        closedWithoutPrice: 0,
      };

    const [experiments, open] = await Promise.all([
      store.listExperiments(),
      store.openTrades(runId),
    ]);
    const prices = await lastPrices(new Set(open.map((t) => t.market)));
    const now = Date.now();
    const plan = planReset({ experiments, open, prices, now });
    const outcome = await resetRun(db, {
      fromRunId: input.fromRunId,
      note: input.note,
      closes: plan.closes,
      state: { [ENGINE_KEYS.bars]: plan.bars },
      initialBudget: await readNextBudget(store),
    });
    const epoch = await getEpoch(db, outcome.runId);
    if (!outcome.created)
      return { created: false, epoch, closed: 0, closedWithoutPrice: 0 };
    log.info(
      "experiments.reset",
      `Новая эпоха #${outcome.runId}: закрыто ${outcome.closed} сделок`,
      { ...outcome, fromRunId: input.fromRunId },
    );
    return {
      created: true,
      epoch,
      closed: outcome.closed,
      closedWithoutPrice: outcome.closedWithoutPrice,
    };
  });
}
