// Композиция demo-зеркала (spec 008): БД (entities/experiment) + биржа (features/execute-trade)
// + логика прогона (features/demo-mirror). Только сервер; вызывает POST /api/cron/demo-mirror.

import {
  ASSET_GROUPS,
  activeMirrors,
  claimMirror,
  claimMirrorToClose,
  claimOpenMirrors,
  type DemoResetResult,
  type DemoResetScope,
  type ExperimentMarket,
  type GroupResetResult,
  listMirrorCandidates,
  listMirrorsToClose,
  listOpenMirrorLegs,
  type MirrorCandidate,
  markDemoReset,
  markMirrorClosedByExchange,
  markMirrorUnprotected,
  updateMirror,
  withMirrorRunLock,
} from "@/entities/experiment";
import {
  emptyMirrorRunResult,
  MIRROR,
  type MirrorRunResult,
  mirrorLogEntry,
  runMirror,
} from "@/features/demo-mirror";
import {
  closeDemoPosition,
  placeTrade,
  sweepTriggeredLegs,
} from "@/features/execute-trade";
import {
  fetchDemoPositionMode,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
} from "@/shared/api/binance/demo.server";
import { demoVenue } from "@/shared/api/binance/venue.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { type Db, getDb, getDbKind } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { getLabSettings } from "./experimentSettings";

const writeMirrorLog = (e: ReturnType<typeof mirrorLogEntry>) =>
  log[e.level](e.event, e.message, e.data);

/**
 * Прогон зеркала под блокировкой (PR 2e): бюджет прогона 200 с больше минуты крона — второй прогон,
 * пока идёт первый, сразу выходит с `locked: true` (открыл бы тот же вход дважды или закрыл чужое).
 */
export async function runDemoMirror(): Promise<MirrorRunResult> {
  const db = getDb();
  const run = await withMirrorRunLock(
    db,
    () => runDemoMirrorUnlocked(db),
    getDbKind() === "postgres",
    MIRROR.lockIdleTimeoutS,
  );
  if (run.acquired) return run.value;
  log.info(
    "mirror.locked",
    "Зеркало: предыдущий прогон ещё идёт — этот пропущен",
    {},
  );
  return emptyMirrorRunResult(getDemoTradingConfig() !== null, true);
}

async function runDemoMirrorUnlocked(db: Db): Promise<MirrorRunResult> {
  // Кандидаты прогона — чтобы claim знал поля сделки по id.
  const byId = new Map<string, MirrorCandidate>();
  // Свободные USDT обоих кошельков — один запрос на прогон (runMirror спрашивает по рынку, spec 0043).
  let balances: ReturnType<typeof fetchDemoUsdtBalances> | null = null;
  const result = await runMirror({
    now: Date.now,
    configured: getDemoTradingConfig() !== null,
    listCandidates: async (since) => {
      const list = await listMirrorCandidates(db, since);
      for (const c of list) byId.set(c.tradeId, c);
      return list;
    },
    activeMirrors: () => activeMirrors(db),
    positionMode: () => {
      const config = getDemoTradingConfig();
      if (!config) return Promise.reject(new Error("Demo не настроен"));
      return fetchDemoPositionMode(demoVenue(config.credentials));
    },
    // null — символа нет на демо; сетевой сбой — исключение (кандидат подождёт). Фьючерсный
    // справочник кэшируется на 10 минут, спот — запрос на символ.
    hasSymbol: async (market, symbol) =>
      (await fetchDemoSymbolRules(market, symbol)) !== null,
    freeUsd: async (market) => {
      const config = getDemoTradingConfig();
      if (!config) throw new Error("Demo не настроен");
      // Сбой — одна запись на прогон (промис общий), вход идёт без проверки резерва (fail-open в runMirror).
      balances ??= fetchDemoUsdtBalances(demoVenue(config.credentials)).catch(
        (error) => {
          log.warn(
            "mirror.balance",
            "Остаток демо-кошелька не прочитан — входы этого прогона без проверки резерва",
            { error: error instanceof Error ? error.message : String(error) },
          );
          throw error;
        },
      );
      return (await balances)[market];
    },
    claim: async (tradeId) => {
      const c = byId.get(tradeId);
      return c ? claimMirror(db, c) : false;
    },
    open: (req) => placeTrade(req),
    // Каждый пропуск и отказ — отдельная запись журнала с experimentId (spec 0016): на неё ведёт
    // ссылка из «N отказ · M пропуск».
    markSkipped: async (tradeId, reason) => {
      await updateMirror(db, tradeId, {
        status: "skipped",
        message: reason,
        steps: [],
      });
      const c = byId.get(tradeId);
      if (c) writeMirrorLog(mirrorLogEntry("skipped", c, reason));
    },
    saveOpen: async (tradeId, r) => {
      await updateMirror(db, tradeId, {
        status: r.status,
        message: r.message,
        steps: r.steps,
        demoRef: r.id,
        entryPrice: r.entryPrice,
        quantity: r.filledQuantity,
        // Свои стоп/тейк (PR 2b): тип TradeResult.protectRefs (shared) совпадает с MirrorProtectRefs.
        protectRefs: r.protectRefs ?? null,
      });
      const c = byId.get(tradeId);
      if (c && r.status === "rejected")
        writeMirrorLog(mirrorLogEntry("rejected", c, r.message));
    },
    sweepLegs: async (overBudget) => {
      const swept = await sweepTriggeredLegs(
        await listOpenMirrorLegs(db),
        overBudget,
      );
      const closed: { tradeId: string; symbol: string }[] = [];
      for (const m of swept) {
        // Нога сработала раньше входа: позиция открыта без стопа — строка не закрыта, тревога.
        if (m.status === "unprotected") {
          // Только из открытых статусов: сброс/ручное закрытие могли уже закрыть строку.
          if (
            await markMirrorUnprotected(db, m.tradeId, {
              message: m.message,
              steps: m.steps,
            })
          )
            log.error("mirror.legs", `${m.symbol}: ${m.message}`, {
              tradeId: m.tradeId,
            });
          continue;
        }
        if (
          await markMirrorClosedByExchange(db, m.tradeId, {
            message: m.message,
            steps: m.steps,
            exitPrice: m.exitPrice,
          })
        )
          closed.push({ tradeId: m.tradeId, symbol: m.symbol });
      }
      return closed;
    },
    listToClose: () => listMirrorsToClose(db),
    claimToClose: (tradeId) => claimMirrorToClose(db, tradeId),
    close: (req) => closeDemoPosition(req),
    saveClose: (tradeId, r) =>
      updateMirror(db, tradeId, {
        status: r.status === "closed" ? "closed" : "close_failed",
        message: r.message,
        steps: r.steps,
        exitPrice: r.exitPrice,
        closed: r.status === "closed",
      }),
  });
  if (
    result.opened.length ||
    result.closed.length ||
    result.skipped ||
    result.deferred ||
    result.deferredCloses ||
    result.swept.length
  )
    log.info(
      "mirror.run",
      `Зеркало: открыто ${result.opened.length}, закрыто ${result.closed.length}, пропущено ${result.skipped}${result.deferred ? `, входов отложено до следующего прогона ${result.deferred}` : ""}${result.deferredCloses ? `, закрытий отложено ${result.deferredCloses}` : ""}${result.swept.length ? `, закрыто биржей (вторая нога снята) ${result.swept.length}` : ""}`,
      { ...result },
    );
  return result;
}

/** Закрыть демо-позиции и отметить демо-сброс в scope; сколько закрыто, не закрылось и экспериментов отмечено. */
async function resetDemoScope(scope: DemoResetScope) {
  const db = getDb();
  let closed = 0;
  let failed = 0;
  for (const m of await claimOpenMirrors(db, scope)) {
    const r = await closeDemoPosition(m);
    await updateMirror(db, m.tradeId, {
      status: r.status === "closed" ? "closed" : "close_failed",
      message: `Демо-сброс: ${r.message}`,
      steps: r.steps,
      exitPrice: r.exitPrice,
      closed: r.status === "closed",
    });
    if (r.status === "closed") closed++;
    else failed++;
  }
  const experiments = await markDemoReset(db, scope);
  const target =
    scope === null
      ? "всех экспериментов"
      : typeof scope === "string"
        ? scope
        : `группы ${scope.market}`;
  log.info(
    "mirror.reset",
    `Демо-сброс ${target}: закрыто ${closed}, не закрылось ${failed}`,
    {
      experimentId: typeof scope === "string" ? scope : null,
      market: scope !== null && typeof scope === "object" ? scope.market : null,
      closed,
      failed,
    },
  );
  return { closed, failed, experiments };
}

/**
 * Демо-сброс (решение пользователя 2026-10-11): закрыть по рынку открытые демо-позиции эксперимента
 * (id) или всех (null) и начать его демо-статистику заново (experiments.demo_reset_at). Paper-сделки
 * не трогаются; зеркало продолжает работать для отмеченных экспериментов. Не закрывшиеся позиции —
 * close_failed, их повторит крон зеркала.
 */
export async function resetDemo(
  experimentId: string | null,
): Promise<DemoResetResult> {
  const { closed, failed } = await resetDemoScope(experimentId);
  return { closed, failed, settings: await getLabSettings() };
}

/**
 * Демо-сброс группы активов (spec 0038): то же для всех экспериментов группы, включая выключенные. Группа без
 * демо-зеркала (COIN-M) — { blocked }: позиций там нет, отметка сброса не нужна.
 */
export async function resetGroupDemo(
  market: ExperimentMarket,
): Promise<GroupResetResult | { blocked: string }> {
  const blocked = ASSET_GROUPS[market].demoMirrorBlocked;
  if (blocked) return { blocked };
  const { closed, failed, experiments } = await resetDemoScope({ market });
  return {
    account: "demo",
    experiments,
    closed,
    closedWithoutPrice: 0,
    failed,
    settings: await getLabSettings(),
  };
}
