import { formatPercent } from "@/shared/lib";

/** Диапазон ставок: «3,61 %» или «3,65–281,48 %». */
export function aprRange(minApr: number, maxApr: number): string {
  return Math.abs(maxApr - minApr) < 0.00005
    ? formatPercent(maxApr)
    : `${formatPercent(minApr).replace(/\s?%$/, "")}–${formatPercent(maxApr)}`;
}
