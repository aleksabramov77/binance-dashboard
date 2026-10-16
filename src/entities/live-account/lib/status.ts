import type {
  LiveHeartbeat,
  LiveState,
  LiveStatus,
  LiveVerdict,
} from "../model/heartbeat";

// Состояние реального счёта для карточки, шапки и уведомлений (spec 0047, AC5–AC7). Чистые функции.

/** Пульс старше порога — воркер молчит. */
export const isSilent = (
  receivedAt: string,
  now: number,
  silentAfterMs: number,
): boolean => now - Date.parse(receivedAt) > silentAfterMs;

/** Что показать: «Не подключён», «молчит с …», «ключ не задан», «заблокирован», «годится». */
export function deriveLiveStatus(
  state: LiveState | null,
  now: number,
  silentAfterMs: number,
): LiveStatus {
  if (!state) return { kind: "not-connected" };
  if (isSilent(state.receivedAt, now, silentAfterMs))
    return { kind: "silent", since: state.receivedAt };
  const h = state.heartbeat;
  if (h.verdict === "no-key") return { kind: "no-key" };
  if (h.verdict === "blocked") return { kind: "blocked", reasons: h.reasons };
  return { kind: "ok", warnings: h.warnings };
}

/** Текст оценки для журнала и Telegram. */
export function verdictText(
  verdict: LiveVerdict,
  reasons: readonly string[],
): string {
  if (verdict === "ok") return "✅ ключ годится · торговля выключена";
  if (verdict === "no-key")
    return "⚪ у воркера не задан ключ (BINANCE_TRADE_API_KEY / SECRET)";
  return `⛔ ключ заблокирован: ${reasons.join("; ") || "причина не указана"}`;
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

export interface LiveEvent {
  level: "info" | "warn";
  message: string;
  /** Отправить в Telegram. «Молчит» и «вернулся» шлёт монитор (тревога и «Восстановлено»). */
  notify: boolean;
}

/**
 * Рукопожатие после старта воркера (явное поле handshake, spec 0049): пульс только запрашивает UID основного счёта —
 * не сохраняется и не считается сменой состояния, иначе каждый перезапуск давал бы пару сообщений «заблокирован» →
 * «годится». Воркер ставит признак только в ветке «ждём UID»; приложение дополнительно требует uid pending — пульс с
 * признаком, но без ожидания UID, сохраняется как обычный. Воркер получает UID в ответе и один раз сразу шлёт полный пульс.
 */
export const isHandshake = (heartbeat: LiveHeartbeat): boolean =>
  heartbeat.handshake && heartbeat.uid?.status === "pending";

/**
 * Приём пульса: новое состояние и события. Смена оценки (годится ↔ заблокирован ↔ ключ не задан) или первый
 * пульс — одна запись live.status и одно сообщение; та же оценка — ничего (без повторов). Пульс после
 * молчания — запись «снова на связи» без Telegram: «Восстановлено» присылает монитор. Рукопожатие (isHandshake) —
 * null: ничего не сохраняется.
 */
export function planHeartbeat(
  prev: LiveState | null,
  heartbeat: LiveHeartbeat,
  now: number,
  silentAfterMs: number,
): { next: LiveState | null; events: LiveEvent[] } {
  if (isHandshake(heartbeat)) return { next: null, events: [] };
  const at = new Date(now).toISOString();
  const events: LiveEvent[] = [];
  const fixture =
    heartbeat.fixture === "demo-venue"
      ? " (площадка демо)"
      : heartbeat.fixture
        ? ` (фикстура ${heartbeat.fixture})`
        : "";
  const level = heartbeat.verdict === "ok" ? "info" : "warn";
  const text = verdictText(heartbeat.verdict, heartbeat.reasons);

  if (!prev) {
    events.push({
      level,
      message: `Воркер реального счёта подключён${fixture}: ${text}`,
      notify: true,
    });
    return {
      next: {
        heartbeat,
        receivedAt: at,
        status: heartbeat.verdict,
        statusSince: at,
        silentSince: null,
      },
      events,
    };
  }

  const gap = now - Date.parse(prev.receivedAt);
  if (prev.silentSince !== null || gap > silentAfterMs)
    events.push({
      level: "info",
      message: `Воркер реального счёта снова на связи: молчал ${minutes(gap)} мин`,
      notify: false,
    });

  const changed = prev.status !== heartbeat.verdict;
  if (changed)
    events.push({
      level,
      message: `Реальный счёт${fixture}: ${text}`,
      notify: true,
    });

  return {
    next: {
      heartbeat,
      receivedAt: at,
      status: heartbeat.verdict,
      statusSince: changed ? at : prev.statusSince,
      silentSince: null,
    },
    events,
  };
}

/**
 * Воркер замолчал (вызывает монитор): одна запись live.status, пока молчание держится. Telegram — тревогой
 * монитора. null — не молчит, пульса не было или уже записано.
 */
export function planSilence(
  state: LiveState | null,
  now: number,
  silentAfterMs: number,
): { next: LiveState; event: LiveEvent } | null {
  if (!state || state.silentSince !== null) return null;
  if (!isSilent(state.receivedAt, now, silentAfterMs)) return null;
  return {
    next: { ...state, silentSince: new Date(now).toISOString() },
    event: {
      level: "warn",
      message: `Воркер реального счёта молчит: последний пульс ${minutes(now - Date.parse(state.receivedAt))} мин назад`,
      notify: false,
    },
  };
}
