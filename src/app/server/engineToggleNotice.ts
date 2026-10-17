// Журнал и уведомление при переключении «Автоторговли» (spec 0044): кто, когда, что осталось без проверки.
// Одна запись engine.toggle с уведомлением — категория «Лаборатория», тихо (spec 0067). Чистые функции + внедрённый
// log.notify — тестируются без сети. Композиция — experimentEngine.ts.
import { describeExposure, type EngineExposure } from "@/entities/experiment";
import type { NotifyInput, NotifyRecord } from "@/shared/notify";

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

/** Текст уведомления. */
export function engineToggleNoticeText(event: EngineToggleEvent): string {
  const head = `Автоторговля ${stateWord(event.enabled)} в ${formatUtcTime(event.at)} (${actorLabel(event)}).`;
  if (event.enabled) return `▶️ ${head}`;
  const tail = event.exposure
    ? `${describeExposure(event.exposure)} — стопы и тейки не проверяются до включения.`
    : "Стопы и тейки открытых paper-сделок и демо-позиций не проверяются до включения.";
  return `⏸ ${head} ${tail}`;
}

/** Вызов log.notify для переключения: запись engine.toggle и тихое уведомление в категории «Лаборатория». */
export function engineToggleNotice(event: EngineToggleEvent): NotifyInput {
  const entry = engineToggleLogEntry(event);
  return {
    level: "info",
    event: "engine.toggle",
    message: entry.message,
    data: entry.data,
    category: "lab",
    text: engineToggleNoticeText(event),
  };
}

export interface AnnounceDeps {
  /** log.notify: запись с итогом доставки; сбой канала — warn notify.failed, без исключения. */
  notify: (input: NotifyInput) => Promise<NotifyRecord>;
  /** Отложить до после ответа (next/server after), чтобы тумблер не ждал отправки. */
  defer: (task: () => Promise<void>) => void;
}

/**
 * Переключение — запись engine.toggle с уведомлением после ответа: запись пишется, когда известен итог доставки (он в
 * её поле notify).
 */
export function announceEngineToggle(
  event: EngineToggleEvent,
  deps: AnnounceDeps,
): void {
  const notice = engineToggleNotice(event);
  deps.defer(async () => {
    await deps.notify(notice);
  });
}
