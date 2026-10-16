// Композиция авто-зеркала (spec 0043): БД и правило (entities/experiment) + журнал и Telegram. Вызывают POST /api/cron/mirror-auto (pg_cron раз в сутки), перевод в «Авто» из /settings и /experiments
// (experimentSettings.setDemoMirrorMode) и `pnpm lab:apply --mirror-auto`. Только сервер.
import {
  decideMirrorAuto,
  type MirrorAdvice,
  type MirrorAutoDecision,
  type MirrorAutoPatch,
  mirrorAdviceMessage,
  mirrorChangeMessage,
  mirrorWindowR,
  mirrorWindowStart,
  readMirrorAutoRows,
  saveMirrorAuto,
} from "@/entities/experiment";
import { sendTelegramMessage } from "@/shared/api/telegram";
import {
  getDemoTradingConfig,
  getTelegramConfig,
} from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";

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
  /** Telegram: сколько ушло и не ушло; skipped — почему не отправлялось (только журнал). */
  telegram: { sent: number; failed: number; skipped: string | null };
}

const NO_KEY =
  "На сервере не задан ключ Binance Demo (BINANCE_DEMO_API_KEY / SECRET) — автомат ничего не включает.";

/**
 * Проверка авто-зеркала: правило spec 0043 к экспериментам (ids — только к этим). «Авто» — включить или выключить
 * зеркало, «Вкл» / «Выкл» — только подсказка. Каждое изменение и подсказка — запись журнала и сообщение в Telegram
 * (только production). dryRun — тот же план без записи в БД, журнал и Telegram.
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
    telegram: { sent: 0, failed: 0, skipped: null },
  };
  const db = getDb();
  const data = await readMirrorAutoRows(db, options.ids);
  if (!data) return result;
  const at = new Date().toISOString();
  const outbox: string[] = [];

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
          snapshot: { at, ...verdict, demoMirror: plan.change },
          ...(plan.adviceState !== undefined && { advice: plan.adviceState }),
        });
        // Переключатель сменили, пока шла проверка, — решение устарело.
        if (!applied) continue;
        log.info("mirror.auto", message, logData);
        outbox.push(message);
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
      const patch: MirrorAutoPatch = {};
      if (row.mode === "auto")
        patch.snapshot = { at, ...verdict, demoMirror: row.demoMirror };
      if (plan.adviceState !== undefined) patch.advice = plan.adviceState;
      if (patch.snapshot || patch.advice !== undefined)
        await saveMirrorAuto(db, row.id, row.mode, patch);
    }
    if (plan.sendAdvice) {
      const message = mirrorAdviceMessage(plan);
      if (!dryRun) {
        log.info("mirror.advice", message, logData);
        outbox.push(message);
      }
      result.advice.push({ id: row.id, advice: plan.sendAdvice, message });
    }
  }

  if (!dryRun) result.telegram = await notify(outbox);
  return result;
}

/**
 * Сообщения в Telegram по одному. Не production (локальный сервер worktree с прод-.env.local, скрипты) или нет
 * TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID — только журнал. Сбой отправки изменения в БД не отменяет — warn в журнале.
 */
async function notify(
  messages: string[],
): Promise<MirrorAutoResult["telegram"]> {
  const out = { sent: 0, failed: 0, skipped: null as string | null };
  if (!messages.length) return out;
  if (process.env.NODE_ENV !== "production")
    return { ...out, skipped: "не production — сообщения только в журнале" };
  const telegram = getTelegramConfig();
  if (!telegram?.chatId)
    return {
      ...out,
      skipped:
        "Telegram не настроен (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID) — сообщения только в журнале",
    };
  for (const text of messages) {
    try {
      await sendTelegramMessage(telegram.token, telegram.chatId, text);
      out.sent++;
    } catch (error) {
      out.failed++;
      log.warn("mirror.telegram", "Сообщение авто-зеркала не ушло в Telegram", {
        text,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}
