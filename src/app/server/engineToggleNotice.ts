// Журнал и Telegram при переключении «Автоторговли» (spec 0044): кто, когда, что осталось без проверки.
// Чистые функции + отправка с внедрённым send — тестируются без сети. Композиция — experimentEngine.ts.
import { describeExposure, type EngineExposure } from "@/entities/experiment";

/** Кто переключил: логин GitHub из сессии; authEnabled — настроен ли вход вообще. */
export interface EngineToggleActor {
  by: string | null;
  authEnabled: boolean;
}

export interface EngineToggleEvent extends EngineToggleActor {
  enabled: boolean;
  at: Date;
  /** Только при выключении; null — не посчитали (сбой БД) или включение. */
  exposure: EngineExposure | null;
}

/** Подпись «кто» для людей: логин; без настроенного входа (локально) — «вход выключен». */
export const actorLabel = ({ by, authEnabled }: EngineToggleActor): string =>
  by ?? (authEnabled ? "логин неизвестен" : "вход выключен");

/** «14:05 UTC» — 24 ч, всегда UTC. */
export const formatUtcTime = (at: Date): string =>
  `${at.toISOString().slice(11, 16)} UTC`;

const stateWord = (enabled: boolean) => (enabled ? "включена" : "выключена");

/** Запись engine.toggle для /logs. */
export function engineToggleLogEntry(event: EngineToggleEvent): {
  message: string;
  data: Record<string, unknown>;
} {
  return {
    message: `Автоторговля ${stateWord(event.enabled)} (${actorLabel(event)})`,
    data: {
      enabled: event.enabled,
      by: event.by,
      // Не `source`: это поле в /logs занято платформой (local / vercel — где записан журнал).
      origin: "ui",
      ...(event.enabled
        ? {}
        : {
            openPaper: event.exposure?.openPaper ?? null,
            openDemo: event.exposure?.openDemo ?? null,
          }),
    },
  };
}

/** Текст уведомления в Telegram. */
export function engineToggleTelegramText(event: EngineToggleEvent): string {
  const head = `Автоторговля ${stateWord(event.enabled)} в ${formatUtcTime(event.at)} (${actorLabel(event)}).`;
  if (event.enabled) return `▶️ ${head}`;
  const tail = event.exposure
    ? `${describeExposure(event.exposure)} — стопы и тейки не проверяются до включения.`
    : "Стопы и тейки открытых paper-сделок и демо-позиций не проверяются до включения.";
  return `⏸ ${head} ${tail}`;
}

export type NotifyOutcome = "sent" | "skipped" | "failed";

/**
 * Отправить уведомление; send = null — Telegram не настроен, молча пропускаем. Ошибка Telegram не
 * пробрасывается: переключение уже сделано, о сбое — warn через onError.
 */
export async function notifyEngineToggle(
  text: string,
  send: ((text: string) => Promise<void>) | null,
  onError: (error: unknown) => void,
): Promise<NotifyOutcome> {
  if (!send) return "skipped";
  try {
    await send(text);
    return "sent";
  } catch (error) {
    onError(error);
    return "failed";
  }
}

export interface AnnounceDeps {
  info: (event: string, message: string, data: Record<string, unknown>) => void;
  warn: (event: string, message: string, data: Record<string, unknown>) => void;
  /** Telegram настроен (токен и chat id) — отправка; иначе null. */
  send: ((text: string) => Promise<void>) | null;
  /** Отложить отправку до после ответа (next/server after), чтобы тумблер не ждал Telegram. */
  defer: (task: () => Promise<void>) => void;
}

/** Записать переключение в журнал сразу и отложенно уведомить Telegram; сбой Telegram — warn engine.toggle.notify. */
export function announceEngineToggle(
  event: EngineToggleEvent,
  deps: AnnounceDeps,
): void {
  const entry = engineToggleLogEntry(event);
  deps.info("engine.toggle", entry.message, entry.data);
  const text = engineToggleTelegramText(event);
  deps.defer(async () => {
    await notifyEngineToggle(text, deps.send, (error) =>
      deps.warn(
        "engine.toggle.notify",
        `Telegram: уведомление о переключении автоторговли не отправлено — ${error instanceof Error ? error.message : String(error)}`,
        { enabled: event.enabled },
      ),
    );
  });
}
