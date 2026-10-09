import { normalizeProducts, type Snapshot } from "@/entities/earn-offer";
import { fetchEarnProducts, fetchTickerPrices } from "@/shared/api/binance";
import { saveSnapshot } from "../api/snapshotStore";

/** Скачивает свежие предложения Binance Earn и сохраняет снимок на диск. */
export async function collectSnapshot(): Promise<{
  snapshot: Snapshot;
  file: string;
}> {
  const [products, prices] = await Promise.all([
    fetchEarnProducts(),
    fetchTickerPrices(),
  ]);
  const snapshot: Snapshot = {
    fetchedAt: new Date().toISOString(),
    offers: normalizeProducts(products, prices),
  };
  const file = await saveSnapshot(snapshot);
  return { snapshot, file };
}
