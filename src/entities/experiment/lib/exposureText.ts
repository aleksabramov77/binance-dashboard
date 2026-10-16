import { pluralRu } from "@/shared/lib";
import type { EngineExposure } from "../model/exposure";

/** «Открыто 2 paper-сделки и 1 демо-позиция» — для модалки выключения и Telegram (spec 0044). */
export function describeExposure({
  openPaper,
  openDemo,
}: EngineExposure): string {
  return `Открыто ${pluralRu(openPaper, ["paper-сделка", "paper-сделки", "paper-сделок"])} и ${pluralRu(openDemo, ["демо-позиция", "демо-позиции", "демо-позиций"])}`;
}
