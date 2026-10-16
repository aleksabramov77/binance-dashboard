import { z } from "zod";
import { mirrorProtectRefsSchema, mirrorStatusSchema } from "./mirror";

// Контракт API реального зеркала воркер ↔ приложение (spec 0049): POST /api/live/mirror/*, Bearer LIVE_WORKER_SECRET.
// У воркера нет БД: кандидаты, захват, сохранение входов и закрытий, лимиты и стоп — через эти маршруты. Тела и ответы
// проверяют обе стороны. Не strictObject: воркер (VM) и приложение выкатываются отдельно.

const market = z.enum(["spot", "usdm"]);
const direction = z.enum(["long", "short"]);
const isoTime = z.iso.datetime({ offset: true });
const text = z.string().max(2000);

export const liveMirrorStepSchema = z.object({
  label: z.string().max(200),
  ok: z.boolean(),
  detail: text,
});

export const liveCandidateSchema = z.object({
  tradeId: z.string().min(1),
  experimentId: z.string().min(1),
  market,
  symbol: z.string().min(1),
  direction,
  openedAt: isoTime,
  entryPrice: z.number(),
  quantity: z.number(),
  stop: z.number().nullable(),
  takeProfit: z.number().nullable(),
});
export type LiveCandidate = z.infer<typeof liveCandidateSchema>;

export const liveHaltStateSchema = z.object({
  stopped: z.boolean(),
  closeAllRequested: z.boolean(),
});

/** Состояние прогона: читается одним запросом в начале прогона воркера. */
export const liveMirrorStateSchema = z.object({
  halt: liveHaltStateSchema,
  candidates: z.array(liveCandidateSchema),
  active: z.array(
    z.object({
      tradeId: z.string(),
      experimentId: z.string(),
      market,
      symbol: z.string(),
      direction,
      status: mirrorStatusSchema,
      /** Когда строка создана (вход). */
      openedAt: isoTime,
      /** Цена и объём входа — оценка PnL, если исполнения не прочитаны. */
      entryPrice: z.number().nullable().default(null),
      quantity: z.number().nullable().default(null),
      /** Цена своего стопа — худший случай оценки PnL без цены выхода. */
      stopLoss: z.number().nullable().default(null),
    }),
  ),
  /** Реализованный PnL экспериментов за текущие сутки UTC, $. */
  dailyPnl: z.record(z.string(), z.number()),
  dayStart: isoTime,
  toClose: z.array(z.string()),
  /** «Потерянные» входы: pending дольше LIVE_PENDING_STALE_S — воркер сверяет их с биржей по своему clientOrderId. */
  stalePending: z
    .array(
      z.object({
        tradeId: z.string(),
        experimentId: z.string(),
        market,
        symbol: z.string(),
        direction,
        openedAt: isoTime,
      }),
    )
    .default([]),
  openLegs: z.array(
    z.object({
      tradeId: z.string(),
      symbol: z.string(),
      status: mirrorStatusSchema,
      protectRefs: mirrorProtectRefsSchema,
    }),
  ),
});
export type LiveMirrorState = z.infer<typeof liveMirrorStateSchema>;

export const liveTradeIdSchema = z.object({ tradeId: z.string().min(1) });

export const liveClaimReplySchema = z.object({
  claimed: z.boolean(),
  /**
   * Почему не захвачено: taken — сделку или монету уже взяли; halted — стоп входов (проверка в БД перед каждым
   * входом); disabled — «Реальный счёт» эксперимента выключили; limit — уже 5 открытых позиций.
   */
  reason: z.enum(["taken", "halted", "disabled", "limit"]).nullable(),
});

export const liveSkipRequestSchema = liveTradeIdSchema.extend({
  reason: z.string().min(1).max(500),
});

export const liveOpenRequestSchema = liveTradeIdSchema.extend({
  result: z.object({
    id: z.string(),
    status: z.enum(["protected", "unprotected", "rejected"]),
    message: text,
    entryPrice: z.number().nullable(),
    filledQuantity: z.number().nullable(),
    steps: z.array(liveMirrorStepSchema).max(100),
    protectRefs: mirrorProtectRefsSchema.nullable(),
  }),
  /** Уровни и объём заявки — для Telegram. */
  order: z.object({
    stopLoss: z.number(),
    takeProfit: z.number().nullable(),
    notionalUsd: z.number(),
    /** Почему объём выше $10 (sizeEntry); null — не поднят. */
    raised: z.enum(["minNotional", "minQty", "spotStop"]).nullable(),
  }),
});
export type LiveOpenRequest = z.infer<typeof liveOpenRequestSchema>;

/** Реальная позиция на закрытие (захват — по одной). */
export const liveToCloseSchema = z.object({
  tradeId: z.string(),
  experimentId: z.string(),
  market,
  symbol: z.string(),
  direction,
  quantity: z.number(),
  exitReason: z.string().nullable(),
  protectRefs: mirrorProtectRefsSchema.nullable(),
  entryPrice: z.number().nullable(),
  /** Цена своего стопа — худший случай оценки PnL без цены выхода; null — не известна. */
  stopLoss: z.number().nullable().default(null),
  openedAt: isoTime,
});
export type LiveToClose = z.infer<typeof liveToCloseSchema>;

export const liveClaimCloseReplySchema = z.object({
  item: liveToCloseSchema.nullable(),
});

/** Итог закрытия по исполнениям: цена выхода, комиссии, PnL, чем закрыта. */
export const liveExitSchema = z.object({
  message: text,
  steps: z.array(liveMirrorStepSchema).max(100),
  exitPrice: z.number().nullable(),
  feesUsd: z.number().nullable(),
  realizedPnl: z.number().nullable(),
  closedBy: z.enum(["tp", "sl", "mirror", "close_all"]).nullable(),
  /** PnL — оценка по ценам входа и выхода с комиссией по ставке (исполнения не прочитаны). */
  pnlEstimated: z.boolean().default(false),
  /** Нераспроданный остаток монеты (спот) — на субсчёте, в PnL не входит; null — остатка нет. */
  leftover: z
    .object({ qty: z.number(), asset: z.string(), usd: z.number() })
    .nullable()
    .default(null),
});

export const liveCloseRequestSchema = liveTradeIdSchema.extend({
  status: z.enum(["closed", "failed"]),
  exit: liveExitSchema,
  /** Не закрылось, а свои TP/SL в этой попытке уже сняты — позиция без защиты (повтор каждый прогон). */
  protectionRemoved: z.boolean().default(false),
});
export type LiveCloseRequest = z.infer<typeof liveCloseRequestSchema>;

/** Сверка ног: позицию закрыла биржа (closed) или нога сработала до входа (unprotected). */
export const liveLegsRequestSchema = z.object({
  items: z
    .array(
      liveTradeIdSchema.extend({
        outcome: z.enum(["closed", "unprotected"]),
        exit: liveExitSchema,
      }),
    )
    .max(50),
});
export type LiveLegsRequest = z.infer<typeof liveLegsRequestSchema>;

/** «Закрыть всё»: захват всех открытых позиций (claim) и итог (done). */
export const liveCloseAllRequestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("claim") }),
  z.object({
    phase: z.literal("done"),
    closed: z.number().int().min(0),
    failed: z.number().int().min(0),
    errors: z.array(z.string().max(500)).max(50),
  }),
]);
export const liveCloseAllReplySchema = z.object({
  items: z.array(liveToCloseSchema),
});

export const liveOkSchema = z.object({ ok: z.literal(true) });

/** Переключатель «Реальный счёт» эксперимента (UI → приложение). Включение — только со словом подтверждения. */
export const experimentLiveMirrorSchema = z.object({
  id: z.string().min(1),
  liveMirror: z.boolean(),
  /** Слово подтверждения (LIVE.confirmWord) — обязательно для включения. */
  confirm: z.string().max(20).optional(),
});
export type ExperimentLiveMirror = z.infer<typeof experimentLiveMirrorSchema>;

export const liveMirrorToggleReplySchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  liveMirror: z.boolean(),
});

/**
 * Итог сверки «потерянного» входа (pending дольше LIVE_PENDING_STALE_S) с биржей по своему clientOrderId: open — вход
 * нашёлся и стоп стоит; unprotected — вход нашёлся, стопа нет (⚠️, позиция уйдёт в очередь закрытия); skipped — ордера
 * на бирже нет, входа не было.
 */
export const liveReconcileRequestSchema = liveTradeIdSchema.extend({
  outcome: z.enum(["open", "unprotected", "skipped"]),
  message: text,
  entryPrice: z.number().nullable(),
  quantity: z.number().nullable(),
  protectRefs: mirrorProtectRefsSchema.nullable(),
});
export type LiveReconcileRequest = z.infer<typeof liveReconcileRequestSchema>;
