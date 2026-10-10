import { normalizeProducts, type Snapshot } from "@/entities/earn-offer";
import {
  fetchEarnProducts,
  fetchTickerPrices,
} from "@/shared/api/binance/public.server";
import { saveSnapshot } from "../api/snapshotStore";

/** Скачивает свежие предложения Binance Earn и сохраняет снимок в БД. */
export async function collectSnapshot(): Promise<{ snapshot: Snapshot }> {
  const [products, prices] = await Promise.all([
    fetchEarnProducts(),
    fetchTickerPrices(),
  ]);
  const snapshot: Snapshot = {
    fetchedAt: new Date().toISOString(),
    offers: normalizeProducts(products, prices),
  };
  await saveSnapshot(snapshot);
  return { snapshot };
}
