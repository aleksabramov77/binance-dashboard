// Композиция demo-зеркала (spec 008): БД (entities/experiment) + биржа (features/execute-trade)
// + логика прогона (features/demo-mirror). Только сервер; вызывает POST /api/cron/demo-mirror.
import {
  activeMirrorSymbols,
  claimMirror,
  claimMirrorToClose,
  claimOpenMirrors,
  type DemoResetResult,
  listMirrorCandidates,
  listMirrorsToClose,
  type MirrorCandidate,
  markDemoReset,
  updateMirror,
} from "@/entities/experiment";
import { mirrorLogEntry, runMirror } from "@/features/demo-mirror";
import { closeDemoPosition, placeTrade } from "@/features/execute-trade";
import { fetchDemoSymbolRules } from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { getLabSettings } from "./experimentSettings";

const writeMirrorLog = (e: ReturnType<typeof mirrorLogEntry>) =>
  log[e.level](e.event, e.message, e.data);

export async function runDemoMirror() {
  const db = getDb();
  // Кандидаты прогона — чтобы claim знал поля сделки по id.
  const byId = new Map<string, MirrorCandidate>();
  const result = await runMirror({
    now: Date.now,
    configured: getDemoTradingConfig() !== null,
    listCandidates: async (since) => {
      const list = await listMirrorCandidates(db, since);
      for (const c of list) byId.set(c.tradeId, c);
      return list;
    },
    busySymbols: () => activeMirrorSymbols(db),
    // null — символа нет на демо; сетевой сбой — исключение (кандидат подождёт). Фьючерсный
    // справочник кэшируется на 10 минут, спот — запрос на символ.
    hasSymbol: async (market, symbol) =>
      (await fetchDemoSymbolRules(market, symbol)) !== null,
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
    result.deferredCloses
  )
    log.info(
      "mirror.run",
      `Зеркало: открыто ${result.opened.length}, закрыто ${result.closed.length}, пропущено ${result.skipped}${result.deferred ? `, входов отложено до следующего прогона ${result.deferred}` : ""}${result.deferredCloses ? `, закрытий отложено ${result.deferredCloses}` : ""}`,
      { ...result },
    );
  return result;
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
  const db = getDb();
  let closed = 0;
  let failed = 0;
  for (const m of await claimOpenMirrors(db, experimentId)) {
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
  await markDemoReset(db, experimentId);
  log.info(
    "mirror.reset",
    `Демо-сброс ${experimentId ?? "всех экспериментов"}: закрыто ${closed}, не закрылось ${failed}`,
    { experimentId, closed, failed },
  );
  return { closed, failed, settings: await getLabSettings() };
}
