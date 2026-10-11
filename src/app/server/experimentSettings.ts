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
  setExperimentDemoMirror,
  setExperimentEnabled,
  withEngineTickLock,
} from "@/entities/experiment";
import { ENGINE_KEYS, planReset, priceKey } from "@/features/paper-engine";
import { fetch24hTickers } from "@/shared/api/binance/public.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
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
    demoConfigured: getDemoTradingConfig() !== null,
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

/** Demo-зеркало эксперимента (spec 008); null — эксперимента нет. Открытые зеркала не трогаем. */
export async function toggleDemoMirror(
  id: string,
  demoMirror: boolean,
): Promise<LabSettings | null> {
  await ensureEngineReady();
  if (!(await setExperimentDemoMirror(getDb(), id, demoMirror))) return null;
  log.info(
    "experiments.mirror",
    `${id}: demo-зеркало ${demoMirror ? "включено" : "выключено"}`,
  );
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

/** Сколько ждать межпроцессную блокировку тика (тик Supabase или другого экземпляра) перед сбросом. */
const RESET_LOCK_ATTEMPTS = 60;
const RESET_LOCK_RETRY_MS = 1000;

/**
 * «Сбросить тестовые капиталы»: под блокировкой тика закрыть открытые сделки текущей эпохи по
 * последней цене (manual), начать новую эпоху с бюджетом next_budget и пометить текущие свечи
 * обработанными. Тумблер движка не меняется. fromRunId уже не текущая — ничего не делает.
 * Блокировки две: процесса (withTickLock — таймер этого сервера) и межпроцессная advisory lock в БД
 * (withEngineTickLock — та же, что берёт тик, в т.ч. Edge Function Supabase); чтение сделок и запись
 * эпохи — внутри неё, поэтому тик другого раннера не вклинится между ними.
 */
export function resetCapitals(input: ResetRequest): Promise<ResetResult> {
  return withTickLock(async () => {
    await ensureEngineReady();
    const db = getDb();
    const noop = async (runId: number): Promise<ResetResult> => ({
      created: false,
      epoch: await getEpoch(db, runId),
      closed: 0,
      closedWithoutPrice: 0,
    });
    const runId = await createDbExperimentStore(db).currentRunId();
    if (runId !== input.fromRunId) return noop(runId);

    // Сеть — до блокировки: цены по рынкам, где сейчас есть открытые сделки.
    const openBefore = await createDbExperimentStore(db).openTrades(runId);
    const prices = await lastPrices(new Set(openBefore.map((t) => t.market)));

    for (let attempt = 0; attempt < RESET_LOCK_ATTEMPTS; attempt++) {
      const locked = await withEngineTickLock(db, async (tx) => {
        const store = createDbExperimentStore(tx);
        const current = await store.currentRunId();
        if (current !== input.fromRunId)
          return { created: false as const, runId: current };
        const [experiments, open] = await Promise.all([
          store.listExperiments(),
          store.openTrades(current),
        ]);
        const plan = planReset({ experiments, open, prices, now: Date.now() });
        return resetRun(tx, {
          fromRunId: input.fromRunId,
          note: input.note,
          closes: plan.closes,
          state: { [ENGINE_KEYS.bars]: plan.bars },
          initialBudget: await readNextBudget(store),
        });
      });
      if (!locked.acquired) {
        await new Promise((r) => setTimeout(r, RESET_LOCK_RETRY_MS));
        continue;
      }
      const outcome = locked.value;
      if (!outcome.created) return noop(outcome.runId);
      log.info(
        "experiments.reset",
        `Новая эпоха #${outcome.runId}: закрыто ${outcome.closed} сделок`,
        { ...outcome, fromRunId: input.fromRunId },
      );
      return {
        created: true,
        epoch: await getEpoch(db, outcome.runId),
        closed: outcome.closed,
        closedWithoutPrice: outcome.closedWithoutPrice,
      };
    }
    throw new Error(
      "Сброс не выполнен: блокировку тика держит другой процесс дольше минуты. Повторите позже.",
    );
  });
}
