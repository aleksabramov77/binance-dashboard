import type { YieldProduct } from "@/entities/earn-product";

/** Срок и ликвидность простыми словами: «Locked 90 дн.», «гибкий, вывод ~4 дн.». */
export function termLabel(p: YieldProduct): string {
  if (p.lockDays !== null) return `на ${p.lockDays} дн.`;
  if (p.redemptionDays === 0) return "гибкий, вывод сразу";
  if (p.redemptionDays !== null)
    return `гибкий, вывод ~${p.redemptionDays} дн.`;
  return "гибкий";
}
