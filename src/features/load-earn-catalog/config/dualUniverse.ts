/** Монеты и стейблы каталога Dual: 4 × 2 × {CALL, PUT} = 16 пар, у крупных монет по несколько страниц. */
export const DUAL_COINS = ["BTC", "ETH", "BNB", "SOL"] as const;
export const DUAL_STABLES = ["USDT", "USDC"] as const;

/** Каталог по ключу кэшируется на сервере: холодная загрузка — десятки подписанных запросов. */
export const CATALOG_TTL_MS = 5 * 60_000;
/** Публичная сводка меняется редко. */
export const SUMMARY_TTL_MS = 10 * 60_000;
