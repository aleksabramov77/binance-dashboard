// Композиция монитора журнала (платформа): данные из БД (журнал, движок, Earn, pg_cron), разбор ИИ
// через OpenRouter, уведомление в Telegram. Только сервер; вызывает POST /api/cron/log-monitor.
import { and, desc, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { earnSnapshotsTable } from "@/entities/earn-offer";
import { engineStateTable } from "@/entities/experiment";
import { alertStateTable, appLogsTable } from "@/entities/log-entry";
import {
  type AlertRow,
  type Issue,
  MONITOR,
  type MonitorResult,
  type MonitorSnapshot,
  runMonitor,
  type SampleLog,
} from "@/features/log-monitor";
import { ENGINE_KEYS } from "@/features/paper-engine";
import { completeJson } from "@/shared/api/openrouter";
import { sendTelegramMessage } from "@/shared/api/telegram";
import {
  getLlmConfig,
  getLogAnalysisModel,
  getTelegramConfig,
} from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { pruneLogs } from "./logs";

const SITE_URL =
  process.env.SITE_URL ?? "https://binance-dashboard-gold.vercel.app";

const iso = (ms: number) => new Date(ms).toISOString();
const rowsOf = <T>(r: unknown): T[] =>
  Array.isArray(r) ? (r as T[]) : ((r as { rows?: T[] }).rows ?? []);

async function collect(now: number): Promise<MonitorSnapshot> {
  const db = getDb();
  const windowStart = iso(now - MONITOR.windowMs);
  const baselineStart = iso(now - MONITOR.windowMs - MONITOR.baselineMs);

  const errorsByEvent = await db
    .select({
      event: appLogsTable.event,
      window:
        sql<number>`count(*) filter (where ${appLogsTable.ts} >= ${windowStart})`.mapWith(
          Number,
        ),
      baseline:
        sql<number>`count(*) filter (where ${appLogsTable.ts} < ${windowStart})`.mapWith(
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
        sql`(${appLogsTable.data}->>'status')::int >= 500`,
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

  // pg_cron есть только в Supabase; локально (PGlite) таблиц cron нет — пропускаем.
  let cronFailures: MonitorSnapshot["cronFailures"] = [];
  try {
    cronFailures = rowsOf<{
      job: string;
      failed: number;
      last_message: string | null;
    }>(
      await db.execute(sql`
        select j.jobname as job, count(*)::int as failed, max(d.return_message) as last_message
        from cron.job_run_details d join cron.job j using (jobid)
        where d.status = 'failed' and d.start_time >= ${windowStart}::timestamptz
        group by j.jobname`),
    ).map((r) => ({
      job: r.job,
      failed: r.failed,
      lastMessage: r.last_message,
    }));
  } catch {
    cronFailures = [];
  }

  const [earn] = await db
    .select({ at: sql<string | null>`max(${earnSnapshotsTable.fetchedAt})` })
    .from(earnSnapshotsTable);

  return {
    now,
    errorsByEvent,
    http5xxByPath: http5xxByPath.filter((r) => r.path),
    engine: {
      enabled: get(ENGINE_KEYS.enabled) === true,
      lastTickAt: lastTick?.at ? Date.parse(lastTick.at) : null,
      lastErrors: Array.isArray(lastTick?.errors) ? lastTick.errors.length : 0,
    },
    cronFailures,
    earnLastAt: earn?.at ? Date.parse(earn.at) : null,
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
        "Ты дежурный инженер личного дашборда Binance (Next.js на Vercel, Postgres и Edge Function в Supabase, публичное API Binance, OpenRouter). По найденным проблемам и записям журнала коротко объясни по-русски: что сломалось, вероятная причина, что проверить первым. 2–4 предложения, без воды и без markdown.",
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

async function loadAlerts(): Promise<AlertRow[]> {
  const rows = await getDb().select().from(alertStateTable);
  return rows.map((r) => ({ ...r, status: r.status as AlertRow["status"] }));
}

async function saveAlerts(rows: AlertRow[]): Promise<void> {
  const db = getDb();
  for (const r of rows)
    await db
      .insert(alertStateTable)
      .values(r)
      .onConflictDoUpdate({
        target: alertStateTable.key,
        set: {
          status: r.status,
          title: r.title,
          firstSeen: r.firstSeen,
          lastSeen: r.lastSeen,
          lastSent: r.lastSent,
        },
      });
}

/** Прогон монитора по расписанию. */
export async function runLogMonitor(): Promise<MonitorResult> {
  const telegram = getTelegramConfig();
  const chatId = telegram?.chatId;
  const result = await runMonitor({
    collect,
    samples,
    analyze,
    loadAlerts,
    saveAlerts,
    notify:
      telegram && chatId
        ? (text) => sendTelegramMessage(telegram.token, chatId, text)
        : undefined,
    prune: () => pruneLogs(),
    logsUrl: `${SITE_URL}/logs`,
  });
  if (!telegram || !chatId)
    log.warn(
      "monitor.config",
      "Telegram не настроен: уведомления не отправляются",
    );
  if (result.analysisError)
    log.warn("monitor.ai", `Разбор ИИ не удался: ${result.analysisError}`);
  if (result.issues.length || result.resolved)
    log.info(
      "monitor.run",
      `Монитор: проблем ${result.issues.length}, отправлено ${result.sent ? "да" : "нет"}`,
      {
        issues: result.issues.map((i) => i.key),
        notified: result.notified,
        resolved: result.resolved,
      },
    );
  return result;
}

/** Тестовое сообщение в Telegram: проверить бота и chat id. */
export async function sendMonitorTest(): Promise<{
  sent: boolean;
  reason?: string;
}> {
  const telegram = getTelegramConfig();
  if (!telegram) return { sent: false, reason: "TELEGRAM_BOT_TOKEN не задан" };
  if (!telegram.chatId)
    return { sent: false, reason: "TELEGRAM_CHAT_ID не задан" };
  await sendTelegramMessage(
    telegram.token,
    telegram.chatId,
    `✅ Binance Dashboard: уведомления работают. Монитор проверяет журнал каждые 15 минут.\n${SITE_URL}/logs`,
  );
  return { sent: true };
}
