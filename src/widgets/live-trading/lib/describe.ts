import {
  LIVE_AUTO,
  type LiveAutoOff,
  type LiveAutoSnapshot,
  type LiveThresholds,
} from "@/entities/experiment";
import {
  demoTradesText,
  LIVE,
  type LiveExperimentDay,
  type LiveHalt,
  type LiveModeKey,
  type LiveStatus,
  liveAvgR,
  liveUsd,
  lossStreakText,
  thresholdUsd,
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

// ——— Режимы «Авто» и «Вкл + автовыкл» (spec 0053) ———

/** Что значит положение — подсказка у кнопки и описание в модалке. */
export const LIVE_MODE_MEANING: Record<LiveModeKey, string> = {
  off: "Выключить: новых реальных входов нет, открытые позиции доживают со своими TP/SL.",
  auto: `Авто: автомат сам включит реальный счёт, когда у эксперимента ≥ ${LIVE_AUTO.minDemoTrades} закрытых демо-сделок со средним R > 0, и выключит по порогам или когда средний R последних ${LIVE_AUTO.minDemoTrades} демо-сделок < 0. О каждом включении и выключении — Telegram.`,
  on: "Вкл: свежие входы эксперимента повторяются на реальном субсчёте. Автомат не выключает — только подсказывает в Telegram.",
  on_autooff:
    "Вкл + автовыкл: включено сразу; приложение само выключит по порогам — убыток с момента включения или серия убыточных сделок.",
};

/** «$15 или 5 убыточных сделок подряд». */
export const thresholdsText = (t: LiveThresholds) =>
  `${thresholdUsd(t.lossUsd)} или ${lossStreakText(t.streak)}`;

export interface LiveModeView {
  mode: LiveModeKey;
  liveMirror: boolean;
  liveThresholds: LiveThresholds;
  liveAuto: LiveAutoSnapshot | null;
  liveAutoOff: LiveAutoOff | null;
}

/** Решение «Авто» коротко: «Авто · вкл», «Авто · ждёт: 12 из 30 демо-сделок», «Авто · демо R < 0». */
export function liveAutoLabel(e: LiveModeView): string {
  if (e.liveMirror) return "Авто · вкл";
  const a = e.liveAuto;
  if (!a) return "Авто · ждёт проверки";
  const min = LIVE_AUTO.minDemoTrades;
  switch (a.decision) {
    case "paper_off":
      return "Авто · эксперимент выключен";
    case "demo_negative":
      return a.demoAvgR !== null && a.demoAvgR < 0
        ? "Авто · демо R < 0"
        : "Авто · демо R не выше 0";
    default:
      return a.demoMirror
        ? `Авто · ждёт: ${a.demoTrades} из ${min} демо-сделок`
        : `Авто · ждёт: ${a.demoTrades} из ${min}, демо-зеркало выкл`;
  }
}

/** Подпись под переключателем: автовыключение, пороги, решение «Авто»; null — нечего показать. */
export function liveModeNote(
  e: LiveModeView,
  formatTime: (iso: string) => string,
): string | null {
  if (e.mode === "off")
    return e.liveAutoOff
      ? `выключен автоматом ${formatTime(e.liveAutoOff.at)}: ${e.liveAutoOff.reason}`
      : null;
  if (e.mode === "on_autooff")
    return `автовыкл: ${thresholdsText(e.liveThresholds)}`;
  if (e.mode === "auto") return liveAutoLabel(e);
  return null;
}

/** Подсказка при наведении: что значит положение, пороги и последнее решение автомата. */
export function liveModeHint(
  e: LiveModeView,
  formatTime: (iso: string) => string,
): string {
  const lines = [LIVE_MODE_MEANING[e.mode]];
  if (e.mode === "auto" || e.mode === "on_autooff")
    lines.push(
      `Пороги: ${thresholdsText(e.liveThresholds)} с момента включения.`,
    );
  const a = e.liveAuto;
  if (e.mode === "auto" && a)
    lines.push(
      `Проверка ${formatTime(a.checkedAt)}: ${liveAutoLabel(e)}; демо — ${demoTradesText(a.demoTrades)}${a.demoAvgR === null ? "" : `, средний R ${liveAvgR(a.demoAvgR)}`}; реальный PnL ${liveUsd(a.pnlUsd)}, убыточных подряд ${a.lossStreak}.`,
    );
  if (e.mode === "off" && e.liveAutoOff)
    lines.push(
      `Выключен автоматом ${formatTime(e.liveAutoOff.at)}: ${e.liveAutoOff.reason}. Снова включить — только вручную.`,
    );
  return lines.join("\n");
}
