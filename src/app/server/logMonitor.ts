// Композиция монитора журнала (платформа): данные из БД (журнал, движок, Earn), разбор ИИ
// через OpenRouter, задача в приватном репозитории GitHub (spec 0037), уведомление — категория «Ошибки» (spec 0067).
// Только сервер; вызывает POST /api/cron/log-monitor.
import { and, desc, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { earnSnapshotsTable } from "@/entities/earn-offer";
import { engineStateTable } from "@/entities/experiment";
import { appLogsTable } from "@/entities/log-entry";
import {
  type AlertRow,
  githubWarnings,
  type Issue,
  MONITOR,
  type MonitorAlert,
  type MonitorResult,
  type MonitorSnapshot,
  runMonitor,
  type SampleLog,
  trackAlertIssues,
} from "@/features/log-monitor";
import { ENGINE_KEYS } from "@/features/paper-engine";
import { completeJson } from "@/shared/api/openrouter";
import {
  getGithubAlertsConfig,
  getLlmConfig,
  getLogAnalysisModel,
  getSiteLink,
} from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import type { NotifyStatus } from "@/shared/notify";
import { loadAlertState, saveAlertState } from "./alertState";
import { checkLiveSilence } from "./liveAccount";
import { pruneLogs } from "./logs";

const iso = (ms: number) => new Date(ms).toISOString();

async function collect(now: number): Promise<MonitorSnapshot> {
  const db = getDb();
  const windowStart = iso(now - MONITOR.windowMs);
  // В сыром SQL параметр не проходит через тип колонки: app_logs.ts в SQLite — миллисекунды (spec 0059).
  const windowStartMs = now - MONITOR.windowMs;
  const baselineStart = iso(now - MONITOR.windowMs - MONITOR.baselineMs);

  const errorsByEvent = await db
    .select({
      event: appLogsTable.event,
      window:
        sql<number>`count(*) filter (where ${appLogsTable.ts} >= ${windowStartMs})`.mapWith(
          Number,
        ),
      baseline:
        sql<number>`count(*) filter (where ${appLogsTable.ts} < ${windowStartMs})`.mapWith(
          Number,
        ),
    })
    .from(appLogsTable)
    .where(
      and(
        sql`${appLogsTable.level} = 'error'`,
        gte(appLogsTable.ts, baselineStart),
      ),
    )
    .groupBy(appLogsTable.event);

  const http5xxByPath = await db
    .select({
      path: sql<string>`${appLogsTable.data}->>'path'`,
      window: sql<number>`count(*)`.mapWith(Number),
    })
    .from(appLogsTable)
    .where(
      and(
        gte(appLogsTable.ts, windowStart),
        sql`${appLogsTable.event} like 'http%'`,
        sql`cast(${appLogsTable.data}->>'status' as integer) >= 500`,
      ),
    )
    .groupBy(sql`${appLogsTable.data}->>'path'`);

  const state = await db
    .select({ key: engineStateTable.key, value: engineStateTable.value })
    .from(engineStateTable)
    .where(
      inArray(engineStateTable.key, [
        ENGINE_KEYS.enabled,
        ENGINE_KEYS.lastTick,
      ]),
    );
  const get = (k: string) => state.find((s) => s.key === k)?.value;
  const lastTick = get(ENGINE_KEYS.lastTick) as
    | { at?: string; errors?: unknown[] }
    | undefined;

  const [earn] = await db
    // fetched_at в SQLite — миллисекунды UTC; max() отдаёт число без преобразования колонки.
    .select({ at: sql<number | null>`max(${earnSnapshotsTable.fetchedAt})` })
    .from(earnSnapshotsTable);

  // Воркер реального счёта (spec 0047): «молчит» — запись live.status один раз; сбой не ломает монитор.
  let live: MonitorSnapshot["live"] = null;
  try {
    live = await checkLiveSilence(now);
  } catch (error) {
    log.warn(
      "monitor.live",
      "Пульс воркера реального счёта не прочитан",
      undefined,
      error,
    );
  }

  return {
    now,
    errorsByEvent,
    http5xxByPath: http5xxByPath.filter((r) => r.path),
    engine: {
      enabled: get(ENGINE_KEYS.enabled) === true,
      lastTickAt: lastTick?.at ? Date.parse(lastTick.at) : null,
      lastErrors: Array.isArray(lastTick?.errors) ? lastTick.errors.length : 0,
    },
    // pg_cron был только в Supabase; фоновые задачи VM — таймеры процесса (spec 0048), их сбои — в журнале.
    cronFailures: [],
    earnLastAt: earn?.at ?? null,
    live,
  };
}

async function samples(issues: Issue[], since: number): Promise<SampleLog[]> {
  const events = issues.flatMap((i) => (i.match?.event ? [i.match.event] : []));
  const paths = issues.flatMap((i) => (i.match?.path ? [i.match.path] : []));
  const conds = [
    ...(events.length ? [inArray(appLogsTable.event, events)] : []),
    ...paths.map((p) => sql`${appLogsTable.data}->>'path' = ${p}`),
  ];
  if (!conds.length) return [];
  const rows = await getDb()
    .select()
    .from(appLogsTable)
    .where(
      and(
        gte(appLogsTable.ts, iso(since)),
        inArray(appLogsTable.level, ["warn", "error"]),
        or(...conds),
      ),
    )
    .orderBy(desc(appLogsTable.ts))
    .limit(MONITOR.samples);
  return rows.map((r) => ({
    ts: new Date(r.ts).toISOString(),
    level: r.level,
    event: r.event,
    message: r.message,
    error: (r.error as { message?: string } | null)?.message,
  }));
}

const analysisSchema = z.object({ summary: z.string() });

/** Разбор ИИ: что сломалось, вероятная причина, что проверить — 2–4 предложения по-русски. */
async function analyze(
  issues: Issue[],
  logs: SampleLog[],
): Promise<string | null> {
  const llm = getLlmConfig();
  if (!llm) return null;
  const { data } = await completeJson(
    { ...llm, model: getLogAnalysisModel() },
    {
      system:
        "Ты дежурный инженер личного дашборда Binance (Next.js на своей VM AWS Lightsail, база SQLite, публичное API Binance, OpenRouter). По найденным проблемам и записям журнала коротко объясни по-русски: что сломалось, вероятная причина, что проверить первым. 2–4 предложения, без воды и без markdown.",
      user: JSON.stringify({ issues, logs }),
      schemaName: "incident",
      jsonSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
      schema: analysisSchema,
      maxTokens: 400,
    },
  );
  return data.summary.trim() || null;
}

/** Только строки монитора журнала: у порогов места в базе (db.space.*) свои статусы. */
async function loadAlerts(): Promise<AlertRow[]> {
  return (await loadAlertState()).flatMap((r) =>
    r.status === "active" || r.status === "resolved"
      ? [{ ...r, status: r.status }]
      : [],
  );
}

/**
 * Уведомление монитора — запись monitor.alert: новая тревога — со звуком; напоминание, «восстановлено» — тихо.
 * Ответ — итог доставки: failed — монитор повторит недоставленное в следующий прогон, skipped — без повторов.
 */
export async function notifyAlert(alert: MonitorAlert): Promise<NotifyStatus> {
  const notice = await log.notify({
    level: alert.issues.length ? "warn" : "info",
    event: "monitor.alert",
    message: alert.issues.length
      ? `Тревога монитора: ${alert.issues.join(", ")}${alert.resolved.length ? `; восстановлено: ${alert.resolved.join(", ")}` : ""}`
      : `Монитор: восстановлено — ${alert.resolved.join(", ")}`,
    data: { issues: alert.issues, resolved: alert.resolved },
    category: "errors",
    urgent: alert.urgent,
    text: alert.text,
  });
  return notice.status;
}

/** Прогон монитора по расписанию. */
export async function runLogMonitor(): Promise<MonitorResult> {
  const github = getGithubAlertsConfig();
  const result = await runMonitor({
    collect,
    samples,
    analyze,
    loadAlerts,
    saveAlerts: saveAlertState,
    trackIssues: github
      ? (input) => trackAlertIssues(github, input)
      : undefined,
    notify: notifyAlert,
    prune: () => pruneLogs(),
    logsUrl: getSiteLink("/logs"),
  });
  if (result.analysisError)
    log.warn("monitor.ai", `Разбор ИИ не удался: ${result.analysisError}`);
  for (const w of githubWarnings({
    invalid: github?.invalid ?? [],
    errors: result.githubErrors,
    repo: github ? `${github.owner}/${github.repo}` : null,
  }))
    log.warn(w.event, w.message, w.data);
  if (result.issues.length || result.resolved)
    log.info(
      "monitor.run",
      `Монитор: проблем ${result.issues.length}, отправлено ${result.sent ? "да" : "нет"}`,
      {
        issues: result.issues.map((i) => i.key),
        notified: result.notified,
        resolved: result.resolved,
        tracked: result.tracked.map((t) => `${t.key}:${t.action}`),
      },
    );
  return result;
}

/**
 * Пробное сообщение монитора (POST /api/cron/log-monitor?test=1): проверить канал, тему «Ошибки» и chat id. Явная
 * команда — отправляется и вне production, тихо.
 */
export async function sendMonitorTest(): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const notice = await log.notify({
    level: "info",
    event: "monitor.test",
    message: "Пробное сообщение монитора",
    category: "errors",
    test: true,
    text: "✅ Binance Dashboard: уведомления работают. Монитор проверяет журнал каждые 15 минут.",
    link: getSiteLink("/logs"),
  });
  return notice.status === "sent"
    ? { sent: true }
    : { sent: false, reason: notice.reason };
}
