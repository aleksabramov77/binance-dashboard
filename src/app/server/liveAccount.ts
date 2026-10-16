// Композиция реального счёта (spec 0047): приём пульса воркера, UID основного счёта по read-only ключу,
// уведомления о смене состояния (журнал live.status + Telegram), «молчит» для монитора, данные карточки.
// Только сервер. Торгового ключа здесь нет — он только у воркера (scripts/live-worker.ts).
import {
  deriveLiveStatus,
  type LiveEvent,
  type LiveHeartbeat,
  type LiveHeartbeatReply,
  type LiveState,
  type LiveStatusResponse,
  loadLiveState,
  planHeartbeat,
  planSilence,
  saveLiveState,
} from "@/entities/live-account";
import type { MainAccountUid } from "@/shared/api/binance";
import { fetchAccountUid } from "@/shared/api/binance/account.server";
import { sendTelegramMessage } from "@/shared/api/telegram";
import {
  getBinanceCredentials,
  getLiveSilentAfterMs,
  getSiteUrl,
  getTelegramConfig,
} from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";

/** UID основного счёта не меняется — достаточно перечитывать раз в час. */
const MAIN_UID_TTL_MS = 60 * 60_000;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type UidCache = {
  at: number;
  uid: number | null;
  pending: Promise<number> | null;
};
const uidKey = Symbol.for("binance-dashboard.liveMainUid");
const g = globalThis as typeof globalThis & { [uidKey]?: UidCache };

/** UID основного счёта по read-only ключу (AC3). Ключа нет или Binance не ответил — проверка пропускается. */
export async function getMainAccountUid(
  now = Date.now(),
): Promise<NonNullable<MainAccountUid>> {
  const creds = getBinanceCredentials();
  if (!creds)
    return {
      uid: null,
      reason: "у приложения не задан read-only ключ (BINANCE_API_KEY)",
    };
  g[uidKey] ??= { at: 0, uid: null, pending: null };
  const cache = g[uidKey];
  if (cache.uid !== null && now - cache.at < MAIN_UID_TTL_MS)
    return { uid: cache.uid };
  cache.pending ??= fetchAccountUid(creds).finally(() => {
    cache.pending = null;
  });
  try {
    const uid = await cache.pending;
    cache.uid = uid;
    cache.at = now;
    return { uid };
  } catch (error) {
    log.warn("live.uid", "UID основного счёта не получен", {
      error: message(error),
    });
    return {
      uid: null,
      reason: `UID основного счёта не получен: ${message(error)}`,
    };
  }
}

/** Для тестов: сбросить кэш UID. */
export function clearMainAccountUidCache() {
  delete g[uidKey];
}

/**
 * Почему Telegram не отправляется; null — отправлять. Фикстуры и локальные серверы worktree (не production) в чат
 * владельца не пишут: там настоящие тревоги, а .env.local у worktree общий с основным checkout.
 */
function telegramSkip(fixture: LiveHeartbeat["fixture"]): string | null {
  if (fixture) return "фикстура";
  if (process.env.NODE_ENV !== "production") return "не production";
  return getTelegramConfig()?.chatId ? null : "Telegram не настроен";
}

async function emit(events: LiveEvent[], heartbeat: LiveHeartbeat) {
  const data = {
    verdict: heartbeat.verdict,
    reasons: heartbeat.reasons,
    fixture: heartbeat.fixture,
    version: heartbeat.version,
  };
  for (const event of events) {
    let telegram: string | undefined;
    if (event.notify) {
      const skip = telegramSkip(heartbeat.fixture);
      const config = getTelegramConfig();
      if (skip || !config?.chatId) telegram = `не отправлен: ${skip}`;
      else
        try {
          await sendTelegramMessage(
            config.token,
            config.chatId,
            `Binance Dashboard · ${event.message}\n${getSiteUrl()}/settings#live`,
          );
          telegram = "отправлен";
        } catch (error) {
          telegram = `не отправлен: ${message(error)}`;
          log.warn(
            "live.telegram",
            "Сообщение о реальном счёте не отправлено",
            {
              error: message(error),
            },
          );
        }
    }
    log[event.level]("live.status", event.message, { ...data, telegram });
  }
}

/**
 * Приём пульса: последний пульс → БД, смена оценки → live.status + Telegram, ответ воркеру с UID основного
 * счёта (для фикстур и без ключа не нужен).
 */
export async function ingestHeartbeat(
  heartbeat: LiveHeartbeat,
  now = Date.now(),
): Promise<LiveHeartbeatReply> {
  const db = getDb();
  const prev = await loadLiveState(db);
  const { next, events } = planHeartbeat(
    prev,
    heartbeat,
    now,
    getLiveSilentAfterMs(),
  );
  await saveLiveState(db, next);
  await emit(events, heartbeat);
  const reply: LiveHeartbeatReply = { ok: true, verdict: heartbeat.verdict };
  if (heartbeat.fixture === null && heartbeat.verdict !== "no-key")
    reply.mainAccount = await getMainAccountUid(now);
  return reply;
}

/**
 * Монитор: воркер молчит дольше порога → одна запись live.status (Telegram — тревогой монитора). Возвращает
 * время последнего пульса для правила монитора; null — пульса не было (правило не срабатывает).
 */
export async function checkLiveSilence(now = Date.now()): Promise<{
  lastHeartbeatAt: number;
  silentAfterMs: number;
} | null> {
  const db = getDb();
  const state = await loadLiveState(db);
  if (!state) return null;
  const silentAfterMs = getLiveSilentAfterMs();
  const silence = planSilence(state, now, silentAfterMs);
  if (silence) {
    await saveLiveState(db, silence.next);
    log[silence.event.level]("live.status", silence.event.message, {
      lastHeartbeatAt: state.receivedAt,
    });
  }
  return { lastHeartbeatAt: Date.parse(state.receivedAt), silentAfterMs };
}

/** Последний пульс (шапка, карточка). */
export function loadLastLiveState(): Promise<LiveState | null> {
  return loadLiveState(getDb());
}

/** Данные карточки «Реальный счёт» (GET /api/live/status). */
export async function getLiveStatusView(
  now = Date.now(),
): Promise<LiveStatusResponse> {
  const state = await loadLastLiveState();
  const silentAfterMs = getLiveSilentAfterMs();
  return {
    state,
    silentAfterMs,
    current: deriveLiveStatus(state, now, silentAfterMs),
  };
}
