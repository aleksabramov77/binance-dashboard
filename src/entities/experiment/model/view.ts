import {
  experimentConfigSchema,
  experimentSchema,
  marketSchema,
  paperTradeSchema,
} from "@binance-dashboard/trading-core";
import { z } from "zod";
import { disabledInfoSchema } from "./disable";
import { mirrorViewSchema } from "./mirror";
import { demoMirrorModeSchema, mirrorAutoSnapshotSchema } from "./mirrorAuto";

// Контракт API страниц лаборатории: GET /api/experiments и GET /api/experiments/[id] (spec 003, 3b).

export const tradeStatsSchema = z.object({
  trades: z.number(),
  closed: z.number(),
  open: z.number(),
  wins: z.number(),
  losses: z.number(),
  winRate: z.number().nullable(),
  realizedPnl: z.number(),
  fees: z.number(),
  grossProfit: z.number(),
  grossLoss: z.number(),
  profitFactor: z.number().nullable(),
  avgR: z.number().nullable(),
  maxDrawdown: z.number(),
  maxDrawdownPct: z.number(),
  initialBudget: z.number(),
  equity: z.number(),
});

export const equityPointSchema = z.object({
  at: z.string(),
  equity: z.number(),
});

export const runInfoSchema = z.object({
  id: z.number().int(),
  startedAt: z.string(),
});

/**
 * Период страниц лаборатории в query (`?run=`, spec 0046): номер эпохи или all — все эпохи сразу. Нет параметра —
 * текущая эпоха.
 */
export const runParamSchema = z.union([
  z.literal("all"),
  z.coerce.number().int().positive(),
]);
export type RunParam = z.infer<typeof runParamSchema>;

/** Значение ?run= → период; пусто или мусор — null (текущая эпоха). */
export function parseRunParam(
  value: string | null | undefined,
): RunParam | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = runParamSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Что показано (общая часть ответов /experiments, /experiments/[id] и /stats): scope — эпоха или all; run — эпоха
 * scope, для all — текущая; runs — все эпохи, новые сверху; missingRun — запрошенной эпохи нет, показана текущая.
 */
export const runViewSchema = z.object({
  scope: z.union([z.literal("all"), z.number().int()]),
  run: runInfoSchema,
  runs: z.array(runInfoSchema),
  missingRun: z.number().int().nullable(),
});
export type RunView = z.infer<typeof runViewSchema>;

/** Демо-торговля эксперимента с последнего демо-сброса (spec 008), см. MirrorSummary. */
export const demoSummarySchema = z.object({
  trades: z.number().int(),
  open: z.number().int(),
  closed: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  rejected: z.number().int(),
  skipped: z.number().int(),
  pnl: z.number(),
  // Метрики по закрытым демо-сделкам — формулы paper (spec 0016, computeDemoStats).
  grossProfit: z.number(),
  profitFactor: z.number().nullable(),
  maxDrawdownPct: z.number(),
  equity: z.number(),
});

export const experimentSummarySchema = experimentSchema
  .pick({
    id: true,
    market: true,
    name: true,
    hypothesis: true,
    initialBudget: true,
    enabled: true,
    demoMirror: true,
  })
  .extend({
    /** Положение переключателя «Выкл · Авто · Вкл» и последнее решение авто-зеркала (spec 0043). */
    demoMirrorMode: demoMirrorModeSchema,
    demoMirrorAuto: mirrorAutoSnapshotSchema.nullable(),
    /** «Реальный счёт» включён (spec 0049): свежие входы повторяются на торговом субсчёте. */
    liveMirror: z.boolean(),
    stats: tradeStatsSchema,
    demo: demoSummarySchema,
    /** Контрольный эксперимент варианта (spec 0046); null — не вариант. */
    parentId: z.string().nullable(),
    variantNote: z.string().nullable(),
    /** Причина последнего выключения; null — эксперимент включён. */
    disabled: disabledInfoSchema.nullable(),
  });

export const experimentsResponseSchema = runViewSchema.extend({
  /** Тумблер движка: выключен — новых сделок не будет (пустое состояние страницы). */
  engineEnabled: z.boolean(),
  /** На сервере задан ключ Binance Demo — без него демо-торговля не включится (spec 008). */
  demoConfigured: z.boolean(),
  experiments: z.array(experimentSummarySchema),
});

/** Участник группы «контрольный + варианты» на странице эксперимента (spec 0046): метрики за тот же период. */
export const familyMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  market: marketSchema,
  enabled: z.boolean(),
  disabled: disabledInfoSchema.nullable(),
  /** Буква варианта (A, B, …) по порядку id среди вариантов контрольного; у контрольного null. */
  letter: z.string().nullable(),
  variantNote: z.string().nullable(),
  config: experimentConfigSchema,
  stats: tradeStatsSchema,
});

export const experimentDetailResponseSchema = runViewSchema.extend({
  engineEnabled: z.boolean(),
  experiment: experimentSchema,
  /** Причина последнего выключения; null — включён. */
  disabled: disabledInfoSchema.nullable(),
  stats: tradeStatsSchema,
  equity: z.array(equityPointSchema),
  /** Сделки периода, новые сверху; не больше limit из запроса. */
  trades: z.array(paperTradeSchema),
  /** Демо-торговля эксперимента за период (текущая эпоха — с последнего демо-сброса). */
  demo: demoSummarySchema,
  /** Demo-зеркало показанных сделок: id сделки → статус (spec 008). Нет ключа — не зеркалилась. */
  mirrors: z.record(z.string(), mirrorViewSchema),
  /**
   * Контрольный и его варианты (spec 0046): у варианта и у контрольного с вариантами; null — эксперимент сам по себе
   * (или контрольного варианта нет в БД).
   */
  family: z
    .object({
      control: familyMemberSchema,
      variants: z.array(familyMemberSchema),
    })
    .nullable(),
});

export type TradeStatsView = z.infer<typeof tradeStatsSchema>;
export type EquityPointView = z.infer<typeof equityPointSchema>;
export type DemoSummary = z.infer<typeof demoSummarySchema>;
export type ExperimentSummary = z.infer<typeof experimentSummarySchema>;
export type ExperimentsResponse = z.infer<typeof experimentsResponseSchema>;
export type FamilyMember = z.infer<typeof familyMemberSchema>;
export type ExperimentDetailResponse = z.infer<
  typeof experimentDetailResponseSchema
>;
