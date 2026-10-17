// Композиция реального счёта (spec 0047): приём пульса воркера, UID основного счёта по read-only ключу,
// уведомления о смене состояния (журнал live.status с уведомлением, spec 0067), «молчит» для монитора, данные
// карточки. Только сервер. Торгового ключа здесь нет — он только у воркера (scripts/live-worker.ts).
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
import { getLiveSilentAfterMs, getSiteLink } from "@/shared/config/env.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";
import { getMainCredentials } from "./accountKey";

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

/**
 * UID основного счёта по read-only ключу (AC3). Ключа нет — проверка пропускается (transient false). Binance не
 * ответил — последний известный UID процесса, а без него transient true: воркер держит свой известный UID или
 * блокирует (fail-closed).
 */
export async function getMainAccountUid(
  now = Date.now(),
): Promise<NonNullable<MainAccountUid>> {
  const creds = getMainCredentials();
  if (!creds)
    return {
      uid: null,
      reason:
        "у приложения нет read-only ключа основного аккаунта (не введён в «Настройках»)",
      transient: false,
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
      cached: cache.uid !== null,
    });
    // Устаревший, но известный UID лучше «не знаю»: UID счёта не меняется.
    if (cache.uid !== null) return { uid: cache.uid };
    return { uid: null, reason: message(error), transient: true };
  }
}

/** Для тестов: сбросить кэш UID. */
export function clearMainAccountUidCache() {
  delete g[uidKey];
}

/**
 * Текст и ссылка уведомления о реальном счёте (пульс 0047, реальное зеркало 0049) для log.notify: «Binance Dashboard ·
 * …» и ссылка на карточку (`/settings#live`, «Стоп входов» — `#live-stop`). Только production и не фикстуры — решает
 * канал (spec 0067).
 */
export const liveNotice = (
  text: string,
  anchor = "live",
): { text: string; link: string | null } => ({
  text: `Binance Dashboard · ${text}`,
  link: getSiteLink(`/settings#${anchor}`),
});

/**
 * Текст и ссылка уведомления о сделке (вход, итог, без защиты, не закрылась — spec 0068, AC8): текст как есть (по
 * строкам, начинается со значка) и ссылка на страницу эксперимента сделки. Сообщения о счёте целиком — liveNotice.
 */
export const liveTradeNotice = (
  text: string,
  experimentId: string,
): { text: string; link: string | null } => ({
  text,
  link: getSiteLink(`/experiments/${encodeURIComponent(experimentId)}`),
});

async function emit(events: LiveEvent[], heartbeat: LiveHeartbeat) {
  const data = {
    verdict: heartbeat.verdict,
    reasons: heartbeat.reasons,
    fixture: heartbeat.fixture,
    version: heartbeat.version,
  };
  for (const event of events) {
    if (!event.notify) {
      log[event.level]("live.status", event.message, data);
      continue;
    }
    // Состояние воркера — тема «Сервер»: «годится» — тихо, блокировка и «ключ не задан» (warn) — со звуком.
    await log.notify({
      level: event.level,
      event: "live.status",
      message: event.message,
      data,
      category: "server",
      urgent: event.level !== "info",
      fixture: heartbeat.fixture !== null,
      ...liveNotice(event.message),
    });
  }
}

/**
 * Приём пульса: последний пульс → БД, смена оценки → live.status с уведомлением, ответ воркеру с UID основного
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
  // Рукопожатие после старта воркера (UID основного ещё не известен) не сохраняется: следующий пульс — сразу.
  if (next) await saveLiveState(db, next);
  await emit(events, heartbeat);
  const reply: LiveHeartbeatReply = { ok: true, verdict: heartbeat.verdict };
  // UID основного нужен настоящему воркеру и «площадке демо» (у неё тоже идёт UID-проверка); готовым фикстурам — нет.
  if (
    (heartbeat.fixture === null || heartbeat.fixture === "demo-venue") &&
    heartbeat.verdict !== "no-key"
  )
    reply.mainAccount = await getMainAccountUid(now);
  return reply;
}

/**
 * Монитор: воркер молчит дольше порога → одна запись live.status (уведомление — тревогой монитора). Возвращает
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
): Promise<Omit<LiveStatusResponse, "trading">> {
  const state = await loadLastLiveState();
  const silentAfterMs = getLiveSilentAfterMs();
  return {
    state,
    silentAfterMs,
    current: deriveLiveStatus(state, now, silentAfterMs),
  };
}
