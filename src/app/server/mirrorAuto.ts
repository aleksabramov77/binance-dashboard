// Композиция авто-зеркала (spec 0043): БД и правило (entities/experiment) + запись журнала с уведомлением (категория
// «Лаборатория», тихо — spec 0067). Вызывают POST /api/cron/mirror-auto (раз в сутки), перевод в «Авто» из /settings и
// /experiments (experimentSettings.setDemoMirrorMode) и `pnpm lab:apply --mirror-auto`. Только сервер.
import {
  decideMirrorAuto,
  type MirrorAdvice,
  type MirrorAutoDecision,
  type MirrorAutoPatch,
  mirrorAdviceMessage,
  mirrorChangeMessage,
  mirrorWindowR,
  mirrorWindowStart,
  nextMirrorAutoSnapshot,
  readMirrorAutoRows,
  saveMirrorAuto,
} from "@/entities/experiment";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import type { NotifyInput, NotifyRecord } from "@/shared/notify";

export interface MirrorAutoResult {
  dryRun: boolean;
  demoConfigured: boolean;
  /** Почему автомат ничего не включает (нет ключа Binance Demo); null — всё в порядке. */
  reason: string | null;
  /** Сколько экспериментов проверено (группы с демо-зеркалом). */
  checked: number;
  changes: {
    id: string;
    demoMirror: boolean;
    decision: MirrorAutoDecision;
    trades: number;
    avgR: number | null;
    message: string;
  }[];
  advice: { id: string; advice: MirrorAdvice; message: string }[];
  /** Уведомления: сколько ушло и не ушло; skipped — почему не отправлялось (только журнал), первая причина. */
  notify: { sent: number; failed: number; skipped: string | null };
}

const NO_KEY =
  "На сервере не задан ключ Binance Demo (BINANCE_DEMO_API_KEY / SECRET) — автомат ничего не включает.";

/**
 * Проверка авто-зеркала: правило spec 0043 к экспериментам (ids — только к этим). «Авто» — включить или выключить
 * зеркало, «Вкл» / «Выкл» — только подсказка. Каждое изменение и подсказка — запись журнала с уведомлением (отправляет
 * канал — только из production). dryRun — тот же план без записи в БД, журнала и уведомлений.
 */
export async function runMirrorAuto(
  options: { dryRun?: boolean; ids?: string[] } = {},
): Promise<MirrorAutoResult> {
  const dryRun = options.dryRun ?? false;
  const demoConfigured = getDemoTradingConfig() !== null;
  const result: MirrorAutoResult = {
    dryRun,
    demoConfigured,
    reason: demoConfigured ? null : NO_KEY,
    checked: 0,
    changes: [],
    advice: [],
    notify: { sent: 0, failed: 0, skipped: null },
  };
  const db = getDb();
  const data = await readMirrorAutoRows(db, options.ids);
  if (!data) return result;
  const at = new Date().toISOString();
  // Сбой отправки изменения в БД не отменяет: итог — в записи и в счётчиках, сбой канала — warn notify.failed.
  const notify = async (input: Omit<NotifyInput, "category" | "level">) =>
    tally(
      result.notify,
      await log.notify({ ...input, level: "info", category: "lab" }),
    );

  for (const row of data.rows) {
    const start = mirrorWindowStart(data.runStartedAt, row.resetAt, row.since);
    const plan = decideMirrorAuto(
      { ...row, windowR: mirrorWindowR(row.trades, start) },
      demoConfigured,
    );
    if (!plan) continue;
    result.checked++;
    const { verdict } = plan;
    const logData = {
      experimentId: row.id,
      mode: row.mode,
      decision: verdict.decision,
      trades: verdict.trades,
      avgR: verdict.avgR,
    };

    if (plan.change !== null) {
      const message = mirrorChangeMessage(plan);
      if (!dryRun) {
        const applied = await saveMirrorAuto(db, row.id, row.mode, {
          demoMirror: plan.change,
          snapshot: nextMirrorAutoSnapshot(
            row.auto,
            verdict,
            plan.change,
            true,
            at,
          ),
          ...(plan.adviceState !== undefined && {
            advice: { from: row.advice, to: plan.adviceState },
          }),
        });
        // Переключатель сменили, пока шла проверка, — решение устарело.
        if (!applied) continue;
        await notify({ event: "mirror.auto", message, data: logData });
      }
      result.changes.push({
        id: row.id,
        demoMirror: plan.change,
        decision: verdict.decision,
        trades: verdict.trades,
        avgR: verdict.avgR,
        message,
      });
      continue;
    }

    if (!dryRun) {
      // «Авто» — снимок решения для подсказки в UI каждый прогон; ручные — только смена последней подсказки.
      // Не записалось (положение переключили или подсказку уже записала параллельная проверка) — не сообщаем.
      const patch: MirrorAutoPatch = {};
      if (row.mode === "auto")
        patch.snapshot = nextMirrorAutoSnapshot(
          row.auto,
          verdict,
          row.demoMirror,
          false,
          at,
        );
      if (plan.adviceState !== undefined)
        patch.advice = { from: row.advice, to: plan.adviceState };
      if (
        (patch.snapshot || patch.advice) &&
        !(await saveMirrorAuto(db, row.id, row.mode, patch))
      )
        continue;
    }
    if (plan.sendAdvice) {
      const message = mirrorAdviceMessage(plan);
      if (!dryRun)
        await notify({ event: "mirror.advice", message, data: logData });
      result.advice.push({ id: row.id, advice: plan.sendAdvice, message });
    }
  }

  return result;
}

/** Счётчики уведомлений прогона: отправлено, сбой, почему не отправлялось (первая причина). */
function tally(out: MirrorAutoResult["notify"], record: NotifyRecord): void {
  if (record.status === "sent") out.sent++;
  else if (record.status === "failed") out.failed++;
  else out.skipped ??= record.reason ?? null;
}
