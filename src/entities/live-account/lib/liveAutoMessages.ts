import { LIVE } from "../config/liveMirror";
import { liveUsd } from "./money";

// Тексты режимов реального счёта (spec 0053): причина автовыключения (пометка у «Выкл»), Telegram и журнал
// live.auto / live.advice — одни и те же слова. Чистые функции: id эксперимента — настоящий (в журнале и Telegram),
// в тестах и документации — фиктивный.

export type LiveModeKey = "off" | "auto" | "on" | "on_autooff";

/** Подписи положений переключателя. */
export const LIVE_MODE_LABEL: Record<LiveModeKey, string> = {
  off: "Выкл",
  auto: "Авто",
  on: "Вкл",
  on_autooff: "Вкл + автовыкл",
};

/** Порог в $: «$15», «$12,50». */
export const thresholdUsd = (v: number) =>
  Number.isInteger(v) ? `$${v}` : liveUsd(v);

/** Средний R в живых текстах: «+0,18», «−0,12». */
export function liveAvgR(r: number): string {
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return `${sign}${Math.abs(r).toFixed(2).replace(".", ",")}`;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

/** «1 демо-сделка», «31 демо-сделка», «12 демо-сделок». */
export const demoTradesText = (n: number) =>
  `${n} ${plural(n, "демо-сделка", "демо-сделки", "демо-сделок")}`;

/** «5 убыточных сделок подряд», «1 убыточная сделка подряд». */
export const lossStreakText = (n: number) =>
  `${n} ${plural(n, "убыточная сделка", "убыточные сделки", "убыточных сделок")} подряд`;

/** Что сработало — для причины, Telegram и подсказки. */
export type LiveAutoReason =
  | { kind: "loss"; pnlUsd: number; lossUsd: number }
  | { kind: "streak"; lossStreak: number }
  | { kind: "demo"; trades: number; avgR: number };

/** Причина автовыключения: «убыток −$10,40 ≥ порога $10», «5 убыточных сделок подряд», «средний R …». */
export function liveAutoReasonText(r: LiveAutoReason): string {
  if (r.kind === "loss")
    return `убыток ${liveUsd(r.pnlUsd)} ≥ порога ${thresholdUsd(r.lossUsd)}`;
  if (r.kind === "streak") return lossStreakText(r.lossStreak);
  return `средний R последних ${demoTradesText(r.trades)} ${liveAvgR(r.avgR)} < 0`;
}

/** Почему торговли не будет, хотя «Авто» включил: стоп входов или ключ не годится (AC7). */
export type LiveBlock = "halted" | "key" | null;

const BLOCK_TEXT: Record<Exclude<LiveBlock, null>, string> = {
  halted: "входы остановлены — торговли не будет до «Возобновить»",
  key: "ключ реального счёта не годится — торговли не будет, пока ключ не станет «✅»",
};

/** «🤖 S98 → реальный счёт включён (Авто): 31 демо-сделка, средний R +0,18». */
export function liveAutoEnableText(
  experimentId: string,
  demo: { trades: number; avgR: number },
  block: LiveBlock,
): string {
  const tail = block ? `. ⚠️ ${BLOCK_TEXT[block]}` : "";
  return `🤖 ${experimentId} → реальный счёт включён (Авто): ${demoTradesText(demo.trades)}, средний R ${liveAvgR(demo.avgR)}, $${LIVE.notionalUsd} на сделку${tail}`;
}

/** «⛔ S98 → реальный счёт выключен (Авто): 5 убыточных сделок подряд». */
export function liveAutoDisableText(
  experimentId: string,
  mode: LiveModeKey,
  reason: string,
): string {
  return `⛔ ${experimentId} → реальный счёт выключен (${LIVE_MODE_LABEL[mode]}): ${reason}. Открытые позиции доживают со своими TP/SL; снова включить — только вручную.`;
}

/** Подсказка ручному «Вкл» (AC6): «⚠️ S96 — реальный счёт включён вручную: 5 убыточных сделок подряд. …». */
export function liveAdviceText(
  experimentId: string,
  reason: LiveAutoReason,
): string {
  const what =
    reason.kind === "loss"
      ? `убыток ${liveUsd(reason.pnlUsd)} с момента включения (порог ${thresholdUsd(reason.lossUsd)})`
      : liveAutoReasonText(reason);
  return `⚠️ ${experimentId} — реальный счёт включён вручную: ${what}. Вкл + автовыкл бы выключил`;
}

/** Ручное переключение положения (журнал live.toggle и Telegram). */
export function liveModeText(
  experimentId: string,
  mode: LiveModeKey,
  by: string,
  thresholds: { lossUsd: number; streak: number },
): string {
  const limits = `порог ${thresholdUsd(thresholds.lossUsd)} или ${lossStreakText(thresholds.streak)}`;
  if (mode === "off")
    return `💤 Реальный счёт выключен для ${experimentId} (${by}): новых входов нет, открытые позиции доживают со своими TP/SL.`;
  if (mode === "on")
    return `💰 Реальный счёт включён для ${experimentId} (${by}): $${LIVE.notionalUsd} на сделку, лимит −$${LIVE.dailyLossUsd} за сутки.`;
  if (mode === "on_autooff")
    return `💰 Реальный счёт включён для ${experimentId} (${by}, Вкл + автовыкл): $${LIVE.notionalUsd} на сделку, выключится сам — ${limits}.`;
  return `🤖 Реальный счёт ${experimentId} — «Авто» (${by}): включится, когда на демо будет ≥ 30 сделок со средним R > 0; выключится — ${limits} или средний R демо < 0.`;
}
