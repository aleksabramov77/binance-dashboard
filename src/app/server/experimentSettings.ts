// Композиция /settings лаборатории (spec 003, задача 3d): сброс тестовых капиталов (новая эпоха),
// стартовый бюджет следующей эпохи, вкл/выкл экспериментов, отдельный сброс paper-капитала
// эксперимента. Демо-сброс — src/app/server/demoMirror.ts. Только сервер.
import { asc, eq } from "drizzle-orm";
import {
  ASSET_GROUPS,
  budgetFormSchema,
  createDbExperimentStore,
  DEFAULT_INITIAL_BUDGET,
  type ExperimentMarket,
  type ExperimentResetResult,
  experimentsTable,
  getEpoch,
  type LabSettings,
  type ResetRequest,
  type ResetResult,
  readExperimentsOverview,
  resetExperimentRun,
  resetRun,
  setExperimentDemoMirror,
  setExperimentEnabled,
  withEngineTickLock,
} from "@/entities/experiment";
import { ENGINE_KEYS, planReset, priceKey } from "@/features/paper-engine";
import { fetchDemoUsdtBalances } from "@/shared/api/binance/demo.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
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

/** Свободные USDT демо-счёта; ключа нет или биржа не ответила — null (страница не падает). */
async function readDemoBalances(): Promise<LabSettings["demoBalances"]> {
  const config = getDemoTradingConfig();
  if (!config) return null;
  try {
    return await fetchDemoUsdtBalances(config.credentials);
  } catch (error) {
    log.warn("experiments.settings", "Балансы Binance Demo не получены", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getLabSettings(): Promise<LabSettings> {
  await ensureEngineReady();
  const db = getDb();
  const store = createDbExperimentStore(db);
  const demoConfigured = getDemoTradingConfig() !== null;
  const [rows, epoch, overview, demoBalances, nextBudget] = await Promise.all([
    db.select().from(experimentsTable).orderBy(asc(experimentsTable.id)),
    store.currentRunId().then((runId) => getEpoch(db, runId)),
    readExperimentsOverview(db, false, demoConfigured),
    readDemoBalances(),
    readNextBudget(store),
  ]);
  const summaries = new Map(overview.experiments.map((e) => [e.id, e]));
  return {
    epoch,
    currentBudget: Math.max(0, ...rows.map((e) => e.initialBudget)),
    nextBudget,
    demoConfigured,
    demoBalances,
    experiments: rows.flatMap((r) => {
      const e = summaries.get(r.id);
      if (!e) return [];
      return [
        {
          id: e.id,
          market: e.market,
          name: e.name,
          hypothesis: e.hypothesis,
          enabled: e.enabled,
          demoMirror: e.demoMirror,
          initialBudget: e.initialBudget,
          paper: {
            equity: e.stats.equity,
            pnl: e.stats.realizedPnl,
            closed: e.stats.closed,
            open: e.stats.open,
            resetAt: r.resetAt?.toISOString() ?? null,
          },
          demo: {
            ...e.demo,
            resetAt: r.demoResetAt?.toISOString() ?? null,
          },
        },
      ];
    }),
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

/**
 * Demo-зеркало эксперимента (spec 008); null — эксперимента нет, { blocked } — группа не умеет зеркало
 * (COIN-M, spec 0023: «Демо-зеркало COIN-M — позже»). Открытые зеркала не трогаем.
 */
export async function toggleDemoMirror(
  id: string,
  demoMirror: boolean,
): Promise<LabSettings | null | { blocked: string }> {
  await ensureEngineReady();
  const db = getDb();
  const [row] = await db
    .select({ market: experimentsTable.market })
    .from(experimentsTable)
    .where(eq(experimentsTable.id, id));
  if (!row) return null;
  const group = ASSET_GROUPS[row.market as ExperimentMarket];
  if (demoMirror && group?.demoMirrorBlocked)
    return { blocked: group.demoMirrorBlocked };
  if (!(await setExperimentDemoMirror(db, id, demoMirror))) return null;
  log.info(
    "experiments.mirror",
    `${id}: demo-зеркало ${demoMirror ? "включено" : "выключено"}`,
  );
  return getLabSettings();
}

/** Последние цены по рынкам открытых сделок; рынок не ответил — его сделки закроются без цены. */
async function lastPrices(
  markets: Set<ExperimentMarket>,
): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  await Promise.all(
    [...markets].map(async (market) => {
      try {
        for (const [symbol, price] of await fetchTickerPrices(market))
          prices[priceKey(market, symbol)] = price;
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

/**
 * Отдельный сброс paper-капитала эксперимента: под блокировкой тика закрыть его открытые сделки
 * по последней цене (manual), начать его учёт заново (experiments.reset_at) и пометить текущую
 * свечу его TF обработанной. Эпоха и другие эксперименты не меняются. null — нет эксперимента.
 * Демо-позиции закрытых сделок закроет крон зеркала (paper-сделка закрыта → закрыть зеркало).
 */
export function resetExperimentCapital(
  experimentId: string,
): Promise<ExperimentResetResult | null> {
  return withTickLock(async () => {
    await ensureEngineReady();
    const db = getDb();
    const store = createDbExperimentStore(db);
    const experiment = (await store.listExperiments()).find(
      (e) => e.id === experimentId,
    );
    if (!experiment) return null;
    const runId = await store.currentRunId();
    const openBefore = (await store.openTrades(runId)).filter(
      (t) => t.experimentId === experimentId,
    );
    const prices = await lastPrices(new Set(openBefore.map((t) => t.market)));

    for (let attempt = 0; attempt < RESET_LOCK_ATTEMPTS; attempt++) {
      const locked = await withEngineTickLock(db, async (tx) => {
        const s = createDbExperimentStore(tx);
        const current = await s.currentRunId();
        const open = (await s.openTrades(current)).filter(
          (t) => t.experimentId === experimentId,
        );
        const plan = planReset({
          experiments: [experiment],
          open,
          prices,
          now: Date.now(),
        });
        return resetExperimentRun(tx, {
          runId: current,
          experimentId,
          closes: plan.closes,
          bar: plan.bars[experimentId],
          barsKey: ENGINE_KEYS.bars,
        });
      });
      if (!locked.acquired) {
        await new Promise((r) => setTimeout(r, RESET_LOCK_RETRY_MS));
        continue;
      }
      const outcome = locked.value;
      if (!outcome.found) return null;
      log.info(
        "experiments.reset_one",
        `${experimentId}: paper-капитал сброшен, закрыто сделок ${outcome.closed}`,
        { experimentId, ...outcome },
      );
      return {
        closed: outcome.closed,
        closedWithoutPrice: outcome.closedWithoutPrice,
        settings: await getLabSettings(),
      };
    }
    throw new Error(
      "Сброс не выполнен: блокировку тика держит другой процесс дольше минуты. Повторите позже.",
    );
  });
}
