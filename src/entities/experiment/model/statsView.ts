import {
  directionSchema,
  legacyMarketSchema,
  marketSchema,
} from "@binance-dashboard/trading-core";
import { z } from "zod";
import { runParamSchema, runViewSchema, tradeStatsSchema } from "./view";

// Контракт GET /api/experiments/stats — разрезы сделок лаборатории (spec 003, задача 3c).

/** Разрез: по эксперименту, рынку, монете или направлению сделки. */
export const STATS_GROUP_BY = [
  "experiment",
  "market",
  "symbol",
  "direction",
] as const;
/** Период внутри эпохи (или всех эпох): весь, последние 24 часа, последние 7 дней. */
export const STATS_PERIODS = ["epoch", "24h", "7d"] as const;

export const statsGroupBySchema = z.enum(STATS_GROUP_BY);
export const statsPeriodSchema = z.enum(STATS_PERIODS);

/** Параметры запроса. Отсутствующий фильтр — «все»; run не задан — текущая эпоха, all — все эпохи (spec 0046). */
export const statsQuerySchema = z.object({
  groupBy: statsGroupBySchema.default("experiment"),
  /** Старые ссылки ?market=futures — группа USDⓈ-M (spec 0023). */
  market: legacyMarketSchema.optional(),
  experiment: z.string().min(1).optional(),
  direction: directionSchema.optional(),
  symbol: z.string().min(1).optional(),
  period: statsPeriodSchema.default("epoch"),
  run: runParamSchema.optional(),
});

export const statsGroupSchema = z.object({
  key: z.string(),
  /** Подпись группы: «F01 · Имя», «USDⓈ-M», «Long (B)», «BTCUSDT». */
  label: z.string(),
  stats: tradeStatsSchema,
});

/** Период — runViewSchema: эпоха разрезов (scope) или все эпохи, список эпох, несуществующая запрошенная эпоха. */
export const tradeStatsResponseSchema = runViewSchema.extend({
  query: statsQuerySchema,
  /** Начало периода (ISO); null — с начала эпохи (или первой эпохи для all). */
  since: z.string().nullable(),
  /** Итог по всем отфильтрованным сделкам. */
  total: tradeStatsSchema,
  /** Группы — по убыванию реализованного PnL. */
  groups: z.array(statsGroupSchema),
  /** Варианты фильтров: эксперименты каталога и монеты, по которым в периоде были сделки. */
  options: z.object({
    experiments: z.array(
      z.object({ id: z.string(), name: z.string(), market: marketSchema }),
    ),
    symbols: z.array(z.string()),
  }),
});

export type StatsGroupBy = z.infer<typeof statsGroupBySchema>;
export type StatsPeriod = z.infer<typeof statsPeriodSchema>;
/** Запрос до разбора (поля по умолчанию можно не задавать). */
export type StatsQueryInput = z.input<typeof statsQuerySchema>;
export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type StatsGroupView = z.infer<typeof statsGroupSchema>;
export type TradeStatsResponse = z.infer<typeof tradeStatsResponseSchema>;

/** Разбор query-строки: пустые значения — как отсутствующие. */
export function parseStatsQuery(params: URLSearchParams) {
  const raw: Record<string, string> = {};
  for (const [k, v] of params) if (v !== "") raw[k] = v;
  return statsQuerySchema.safeParse(raw);
}
