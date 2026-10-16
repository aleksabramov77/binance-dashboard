import {
  type DemoMirrorMode,
  describeMirrorAuto,
  type MirrorAutoSnapshot,
} from "@/entities/experiment";
import { formatDateTime } from "@/shared/lib";

// Подсказки переключателя «Выкл · Авто · Вкл» (spec 0043): что значит положение и что решил автомат.

export const MODE_MEANING: Record<DemoMirrorMode, string> = {
  off: "Выкл вручную: на демо-счёте не торгует. Автомат не включит, только подскажет в Telegram, если эксперимент похоже недооценён.",
  auto: "Авто: раз в сутки автомат включает зеркало, если в paper ≥ 30 сделок со средним R > 0, и выключает, если средний R последних 30 сделок после включения < 0 или эксперимент выключен.",
  on: "Вкл вручную: каждый новый вход повторяется на демо-счёте Binance. Автомат не выключит, только подскажет в Telegram, если похоже убыточно.",
};

/** Подсказка при наведении: смысл текущего положения и, для «Авто», последнее решение автомата. */
export function mirrorModeHint(
  mode: DemoMirrorMode,
  auto: MirrorAutoSnapshot | null,
): string {
  if (mode !== "auto") return MODE_MEANING[mode];
  const last = auto
    ? `Последнее решение (${formatDateTime(auto.at)}): ${describeMirrorAuto(auto)}.`
    : "Автомат ещё не решал.";
  return `${MODE_MEANING.auto}\n${last}`;
}
