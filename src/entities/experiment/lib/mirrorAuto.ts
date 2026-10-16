import type { MirrorAutoSnapshot } from "../model/mirrorAuto";

// Тексты авто-зеркала (spec 0043): Telegram, журнал и подсказка у переключателя — одни и те же слова.

/** Средний R для сообщений: +0.21, −0.12, 0.00 (точка и типографский минус — как в тексте spec). */
export function formatAvgR(r: number): string {
  const sign = r > 0 ? "+" : r < 0 ? "−" : "";
  return `${sign}${Math.abs(r).toFixed(2)}`;
}

/** 1 сделка, 3 сделки, 30 сделок. */
export function tradesLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? "сделка"
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? "сделки"
        : "сделок";
  return `${n} ${word}`;
}

const DECISION_TEXT: Record<MirrorAutoSnapshot["decision"], string> = {
  enable: "включил",
  disable_loss: "выключил по обратному порогу",
  disable_off: "выключил: эксперимент выключен",
  keep: "оставил",
  no_key: "включил бы, но нет ключа Binance Demo",
};

/** «включил: 34 сделки, средний R +0.21» — без даты (её добавляет место показа). */
export function describeMirrorAuto(s: MirrorAutoSnapshot): string {
  const action =
    s.decision === "keep"
      ? `оставил ${s.demoMirror ? "включённым" : "выключенным"}`
      : DECISION_TEXT[s.decision];
  if (s.decision === "disable_off") return action;
  const stats =
    s.avgR === null
      ? "сделок с R ещё нет"
      : `${tradesLabel(s.trades)}, средний R ${formatAvgR(s.avgR)}`;
  return `${action}: ${stats}`;
}
