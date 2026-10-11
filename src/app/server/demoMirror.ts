// Композиция demo-зеркала (spec 008): БД (entities/experiment) + биржа (features/execute-trade)
// + логика прогона (features/demo-mirror). Только сервер; вызывает POST /api/cron/demo-mirror.
import {
  activeMirrorSymbols,
  claimMirror,
  claimMirrorsToClose,
  listMirrorCandidates,
  type MirrorCandidate,
  updateMirror,
} from "@/entities/experiment";
import { runMirror } from "@/features/demo-mirror";
import { closeDemoPosition, placeTrade } from "@/features/execute-trade";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";

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
