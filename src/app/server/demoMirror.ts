// Композиция demo-зеркала (spec 008): БД (entities/experiment) + биржа (features/execute-trade)
// + логика прогона (features/demo-mirror). Только сервер; вызывает POST /api/cron/demo-mirror.
import {
  activeMirrorSymbols,
  claimMirror,
  claimMirrorsToClose,
  claimOpenMirrors,
  type DemoResetResult,
  listMirrorCandidates,
  type MirrorCandidate,
  markDemoReset,
  updateMirror,
} from "@/entities/experiment";
import { runMirror } from "@/features/demo-mirror";
import { closeDemoPosition, placeTrade } from "@/features/execute-trade";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { getLabSettings } from "./experimentSettings";

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
    claim: async (tradeId) => {
      const c = byId.get(tradeId);
      return c ? claimMirror(db, c) : false;
    },
    open: (req) => placeTrade(req),
    markSkipped: (tradeId, reason) =>
      updateMirror(db, tradeId, {
        status: "rejected",
        message: reason,
        steps: [],
      }),
    saveOpen: (tradeId, r) =>
      updateMirror(db, tradeId, {
        status: r.status,
        message: r.message,
        steps: r.steps,
        demoRef: r.id,
        entryPrice: r.entryPrice,
        quantity: r.filledQuantity,
      }),
    claimToClose: () => claimMirrorsToClose(db),
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
  if (result.opened.length || result.closed.length || result.skipped)
    log.info(
      "mirror.run",
      `Зеркало: открыто ${result.opened.length}, закрыто ${result.closed.length}, пропущено ${result.skipped}`,
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
