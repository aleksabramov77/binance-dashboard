"use client";

import { useQuery } from "@tanstack/react-query";
import { ADVANCED_CATALOG_TTL_MS } from "../config/cache";
import { type AdvancedCatalog, advancedCatalogSchema } from "../model/schema";

const advancedCatalogQueryKey = ["earn-advanced"] as const;

async function getAdvancedCatalog(): Promise<AdvancedCatalog> {
  const res = await fetch("/api/earn/advanced", { cache: "no-store" });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && "error" in body
        ? String(body.error)
        : `Каталог недоступен (${res.status})`;
    throw new Error(message);
  }
  return advancedCatalogSchema.parse(await res.json());
}

/**
 * Каталоги Dual / стейкинга / DeFi по read-only ключу. Вызывать только с вкладок, где они нужны:
 * холодный кэш сервера — десятки подписанных запросов.
 */
export function useAdvancedCatalog() {
  return useQuery({
    queryKey: advancedCatalogQueryKey,
    queryFn: getAdvancedCatalog,
    staleTime: ADVANCED_CATALOG_TTL_MS,
    refetchOnWindowFocus: false,
  });
}
