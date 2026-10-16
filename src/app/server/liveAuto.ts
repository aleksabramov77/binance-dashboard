// Композиция режимов реального счёта «Авто» и «Вкл + автовыкл» (spec 0053): БД и правило (entities/experiment) +
// тексты (entities/live-account) + журнал и Telegram. Вызывают POST /api/cron/mirror-auto (раз в сутки, вместе с
// авто-зеркалом 0043) и перевод в «Авто» из /experiments (liveMirror.setLiveMode). Пороги при закрытии сделки —
// liveMirror.saveLiveClose (closeLiveWithAuto) с той же причиной (liveAutoReasonOf). Только сервер.
import {
  type LiveAutoDecision,
  type LiveAutoPlan,
  type LiveAutoSnapshot,
  type LiveThresholds,
  liveClosedSince,
  liveDemoTrades,
  mirrorWindowStart,
  planLiveAuto,
  readLiveAutoRows,
  saveLiveAuto,
} from "@/entities/experiment";
import {
  deriveLiveStatus,
  type LiveAutoReason,
  type LiveBlock,
  liveAdviceText,
  liveAutoDisableText,
  liveAutoEnableText,
  liveAutoReasonText,
  loadLiveHalt,
} from "@/entities/live-account";
import { getLiveSilentAfterMs } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { loadLastLiveState, notifyLive } from "./liveAccount";

/** Что сработало по плану: порог (убыток, серия) или демо — для причины, Telegram и подсказки; null — ничего. */
export function liveAutoReasonOf(
  plan: LiveAutoPlan,
  thresholds: LiveThresholds,
): LiveAutoReason | null {
  const t = plan.threshold;
  if (
    plan.decision === "disable_loss" ||
    (plan.sendAdvice ?? t.trip) === "loss"
  )
    return { kind: "loss", pnlUsd: t.pnlUsd, lossUsd: thresholds.lossUsd };
  if (
    plan.decision === "disable_streak" ||
    (plan.sendAdvice ?? t.trip) === "streak"
  )
    return { kind: "streak", lossStreak: t.lossStreak };
  if (plan.decision === "disable_demo" && plan.demo?.avgR != null)
    return { kind: "demo", trades: plan.demo.trades, avgR: plan.demo.avgR };
  return null;
}

/** Причина автовыключения текстом (пометка у «Выкл», Telegram). */
export const liveAutoOffReason = (
  plan: LiveAutoPlan,
  thresholds: LiveThresholds,
): string => {
  const reason = liveAutoReasonOf(plan, thresholds);
  return reason ? liveAutoReasonText(reason) : "сработал порог";
};

/** Числа решения для журнала live.auto. */
export const liveAutoLogData = (
  experimentId: string,
  mode: string,
  plan: LiveAutoPlan,
  reason: string | null,
) => ({
  experimentId,
  mode,
  decision: plan.decision,
  demoTrades: plan.demo?.trades ?? null,
  demoAvgR: plan.demo?.avgR ?? null,
  pnlUsd: plan.threshold.pnlUsd,
  lossStreak: plan.threshold.lossStreak,
  liveTrades: plan.threshold.trades,
  unknownPnl: plan.threshold.unknown,
  reason,
});

/** Стоп входов или негодный ключ: «Авто» включает, но торговли не будет (AC7). */
async function liveBlock(): Promise<LiveBlock> {
  const db = getDb();
  if ((await loadLiveHalt(db)).stopped) return "halted";
  const status = deriveLiveStatus(
    await loadLastLiveState(),
    Date.now(),
    getLiveSilentAfterMs(),
  );
  return status.kind === "ok" ? null : "key";
}

export interface LiveAutoResult {
  dryRun: boolean;
  checked: number;
  changes: {
    id: string;
    change: "enable" | "disable";
    decision: LiveAutoDecision;
    message: string;
  }[];
  advice: { id: string; message: string }[];
  /** Эксперименты, проверка которых упала (ничего не изменено). */
  failed: { id: string; error: string }[];
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Проверка режимов реального счёта (AC3, AC4, AC6): «Авто» — включить по демо, выключить по порогам или демо;
 * «Вкл + автовыкл» — выключить по порогам; ручное «Вкл» — подсказка. ids — только эти эксперименты (перевод в
 * «Авто»). dryRun — тот же план без записи, журнала и Telegram. Сбой по эксперименту — warn, остальные идут дальше.
 */
export async function runLiveAuto(
  options: { dryRun?: boolean; ids?: string[] } = {},
): Promise<LiveAutoResult> {
  const dryRun = options.dryRun ?? false;
  const result: LiveAutoResult = {
    dryRun,
    checked: 0,
    changes: [],
    advice: [],
    failed: [],
  };
  const db = getDb();
  const { runStartedAt, rows } = await readLiveAutoRows(db, options.ids);
  if (!rows.length) return result;
  const demo = await liveDemoTrades(
    db,
    rows.filter((r) => r.mode === "auto").map((r) => r.id),
    runStartedAt,
  );
  const at = new Date().toISOString();
  let block: LiveBlock | undefined;

  for (const row of rows) {
    try {
      const trades = demo.get(row.id) ?? [];
      // Окно включения — после включения демо-зеркала, сброса демо и начала эпохи; обратный порог смену демо-зеркала
      // не обнуляет (иначе выключенное по убытку демо-зеркало прятало бы убыток от «Авто»).
      const windowStart = mirrorWindowStart(
        runStartedAt,
        row.demoResetAt,
        row.demoMirrorSince,
      );
      const recentStart = mirrorWindowStart(runStartedAt, row.demoResetAt);
      const plan = planLiveAuto({
        mode: row.mode,
        liveOn: row.liveOn,
        enabled: row.enabled,
        advice: row.advice,
        thresholds: row.thresholds,
        closed: await liveClosedSince(db, row.id, row.since),
        demo:
          row.mode === "auto"
            ? {
                windowR: trades
                  .filter((t) => t.createdAt.getTime() >= windowStart)
                  .map((t) => t.r),
                recentR: trades
                  .filter((t) => t.createdAt.getTime() >= recentStart)
                  .map((t) => t.r),
              }
            : null,
      });
      if (!plan) continue;
      result.checked++;
      const reason =
        plan.change === "disable"
          ? liveAutoOffReason(plan, row.thresholds)
          : null;
      const snapshot: LiveAutoSnapshot | undefined =
        row.mode === "auto"
          ? {
              checkedAt: at,
              decision: plan.decision,
              demoTrades: plan.demo?.trades ?? 0,
              demoAvgR: plan.demo?.avgR ?? null,
              demoMirror: row.demoMirror,
              pnlUsd: plan.threshold.pnlUsd,
              lossStreak: plan.threshold.lossStreak,
            }
          : undefined;

      if (plan.change !== null) {
        if (plan.change === "enable" && block === undefined)
          block = await liveBlock();
        const message =
          plan.change === "enable"
            ? liveAutoEnableText(
                row.id,
                { trades: plan.demo?.trades ?? 0, avgR: plan.demo?.avgR ?? 0 },
                block ?? null,
              )
            : liveAutoDisableText(row.id, row.mode, reason ?? "");
        if (!dryRun) {
          const applied = await saveLiveAuto(db, row, {
            change:
              plan.change === "enable"
                ? { kind: "enable" }
                : { kind: "disable", reason: reason ?? "" },
            snapshot,
            ...(plan.adviceState !== undefined && {
              advice: { from: row.advice, to: plan.adviceState },
            }),
          });
          // Переключатель сменили, пока шла проверка, — решение устарело.
          if (!applied) continue;
          log.info("live.auto", message, {
            ...liveAutoLogData(row.id, row.mode, plan, reason),
            telegram: await notifyLive(message),
          });
        }
        result.changes.push({
          id: row.id,
          change: plan.change,
          decision: plan.decision,
          message,
        });
        continue;
      }

      if (!dryRun && (snapshot || plan.adviceState !== undefined)) {
        const saved = await saveLiveAuto(db, row, {
          snapshot,
          ...(plan.adviceState !== undefined && {
            advice: { from: row.advice, to: plan.adviceState },
          }),
        });
        // Подсказку уже записала параллельная проверка или положение сменили — не сообщаем.
        if (!saved) continue;
      }
      const adviceReason = plan.sendAdvice
        ? liveAutoReasonOf(plan, row.thresholds)
        : null;
      if (adviceReason) {
        const message = liveAdviceText(row.id, adviceReason);
        if (!dryRun)
          log.info("live.advice", message, {
            ...liveAutoLogData(row.id, row.mode, plan, null),
            telegram: await notifyLive(message),
          });
        result.advice.push({ id: row.id, message });
      }
    } catch (error) {
      result.failed.push({ id: row.id, error: errorText(error) });
      log.warn(
        "live.auto",
        `${row.id}: проверка режима реального счёта не удалась — ничего не изменено`,
        { experimentId: row.id, mode: row.mode, error: errorText(error) },
      );
    }
  }
  return result;
}
