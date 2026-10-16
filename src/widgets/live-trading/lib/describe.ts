import {
  LIVE,
  type LiveExperimentDay,
  type LiveHalt,
  type LiveStatus,
  liveUsd,
} from "@/entities/live-account";

// Тексты реального счёта для переключателя, полосы на /experiments и карточки /settings (spec 0049). Время — в
// часовом поясе браузера (formatTime передаёт вызывающий: в тестах — фиксированный).

/** Почему «Вкл» недоступно: ключ не «✅ годится»; null — можно включать. */
export function keyBlockReason(
  status: LiveStatus | null,
  formatTime: (iso: string) => string,
): string | null {
  if (!status) return "Состояние реального счёта загружается";
  switch (status.kind) {
    case "ok":
      return null;
    case "not-connected":
      return "Воркер реального счёта не подключён — включить нельзя";
    case "silent":
      return `Воркер реального счёта молчит с ${formatTime(status.since)} — включить нельзя`;
    case "no-key":
      return "У воркера не задан ключ субсчёта — включить нельзя";
    case "blocked":
      return `Ключ заблокирован: ${status.reasons.join("; ")} — включить нельзя`;
  }
}

/** «−$15,20 за сутки · входы до 03:00» — пометка сработавшего дневного лимита эксперимента; null — не сработал. */
export function dailyLimitNote(
  day: LiveExperimentDay | undefined,
  formatTime: (iso: string) => string,
): string | null {
  if (!day?.limitHit) return null;
  return `${liveUsd(day.dailyPnl)} за сутки · входы до ${formatTime(day.until)}`;
}

/** Торговля: «вкл» / «входы остановлены (кем и когда)». */
export function haltText(
  halt: LiveHalt,
  formatTime: (iso: string) => string,
): string {
  if (!halt.stopped) return "вкл";
  const who = [halt.stoppedBy, halt.stoppedAt && formatTime(halt.stoppedAt)]
    .filter(Boolean)
    .join(", ");
  return `входы остановлены${who ? ` (${who})` : ""}`;
}

/** Строки лимитов для модалки включения. */
export const LIMIT_LINES = [
  `$${LIVE.notionalUsd} на сделку; минимум биржи выше — объём до минимума, но не выше $${LIVE.maxNotionalUsd} (иначе вход пропускается).`,
  `Не больше ${LIVE.maxOpenPositions} открытых реальных позиций на весь субсчёт и одна позиция на монету.`,
  `Убыток эксперимента за сутки UTC −$${LIVE.dailyLossUsd} → его новые входы до 00:00 UTC; остальные эксперименты торгуют.`,
  "Выключение не закрывает открытые реальные позиции: они доживают со своими TP/SL и закрываются вместе с paper-сделкой.",
];
