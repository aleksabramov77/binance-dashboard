import type { MirrorAutoPlan, MirrorAutoVerdict } from "./decideMirrorAuto";
import { formatAvgR, tradesLabel } from "./mirrorAuto";

// Тексты авто-зеркала (spec 0043): одна строка — и в Telegram, и в журнал (/logs, mirror.auto / mirror.advice).

const stats = (v: MirrorAutoVerdict) =>
  `${tradesLabel(v.trades)}, средний R ${formatAvgR(v.avgR ?? 0)}`;

/** «S98 → демо-зеркало включено: 34 сделки, средний R +0.21». */
export function mirrorChangeMessage(
  plan: Pick<MirrorAutoPlan, "id" | "verdict">,
): string {
  const { id, verdict } = plan;
  if (verdict.decision === "enable")
    return `${id} → демо-зеркало включено: ${stats(verdict)}`;
  if (verdict.decision === "disable_off")
    return `${id} → демо-зеркало выключено: эксперимент выключен`;
  return `${id} → демо-зеркало выключено: ${tradesLabel(verdict.trades)} после включения, средний R ${formatAvgR(verdict.avgR ?? 0)}`;
}

/** Подсказка по ручному положению: «⚠️ … похоже убыточно» / «💡 … похоже недооценено». */
export function mirrorAdviceMessage(
  plan: Pick<MirrorAutoPlan, "id" | "verdict" | "sendAdvice">,
): string {
  const { id, verdict } = plan;
  if (plan.sendAdvice === "on")
    return `💡 ${id} — демо-зеркало выключено вручную, а похоже недооценено: ${stats(verdict)}. Авто бы включил`;
  if (verdict.decision === "disable_off")
    return `⚠️ ${id} — демо-зеркало включено вручную, но эксперимент выключен. Авто бы выключил`;
  return `⚠️ ${id} — демо-зеркало включено вручную, но похоже убыточно: ${stats(verdict)}. Авто бы выключил`;
}
