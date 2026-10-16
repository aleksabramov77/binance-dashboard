import { z } from "zod";
import { liveKeyFlagsSchema } from "@/shared/api/binance";

// Контракт «пульса» воркера реального счёта (spec 0047, AC4): POST /api/live/heartbeat раз в минуту.
// Ключа и секрета в пульсе нет — только оценка прав, UID-проверка и остатки субсчёта. Схему проверяют обе
// стороны: воркер (перед отправкой) и приложение (при приёме).

/** Готовые пульсы для локальной проверки без биржи (`pnpm live:worker --fixture …`). */
export const LIVE_FIXTURES = ["ok", "blocked", "main-account"] as const;
export type LiveFixture = (typeof LIVE_FIXTURES)[number];

/** Оценка воркера: ключ годится, заблокирован или не задан. */
export const LIVE_VERDICTS = ["ok", "blocked", "no-key"] as const;
export const liveVerdictSchema = z.enum(LIVE_VERDICTS);
export type LiveVerdict = z.infer<typeof liveVerdictSchema>;

const text = z.string().max(500);
const isoTime = z.iso.datetime({ offset: true });

/** Spot субсчёта: USDT free + locked и equity всех активов в $ (активы без цены — в unpriced). */
export const liveSpotBalanceSchema = z.object({
  usdtFree: z.number(),
  usdtLocked: z.number(),
  equityUsd: z.number().nullable(),
  unpriced: z.array(z.string().max(32)).max(50),
});

/** USDⓈ-M субсчёта: итоги /fapi/v3/account. */
export const liveUsdmBalanceSchema = z.object({
  walletBalance: z.number(),
  availableBalance: z.number(),
  unrealizedProfit: z.number(),
});

export const liveUidCheckSchema = z.object({
  status: z.enum(["different", "same", "skipped", "pending"]),
  note: text.nullable(),
});

export const liveHeartbeatSchema = z.object({
  /** Версия воркера (сборка). */
  version: z.string().min(1).max(64),
  sentAt: isoTime,
  /** Пульс фикстуры (локальная проверка); null — настоящий. */
  fixture: z.enum(LIVE_FIXTURES).nullable(),
  verdict: liveVerdictSchema,
  /** Причины блокировки — по-русски, по каждому пункту. */
  reasons: z.array(text).max(20),
  /** Не блокирует: «фьючерсы недоступны». */
  warnings: z.array(text).max(20),
  /** Последняя проверка прав ключа; flags null — ещё не прочитаны или ответ не распознан. */
  restrictions: z.object({
    flags: liveKeyFlagsSchema.nullable(),
    checkedAt: isoTime.nullable(),
  }),
  /** UID субсчёта ≠ основного (AC3); null — не проверялось (нет ключа, блокировка по правам). */
  uid: liveUidCheckSchema.nullable(),
  spot: liveSpotBalanceSchema.nullable(),
  usdm: liveUsdmBalanceSchema.nullable(),
  /** Почему остатков нет или они неполные. */
  balancesNote: text.nullable(),
  /** Ошибка биржи в этом цикле (сеть, 429/418): оценка при ней не снимается. */
  error: text.nullable(),
});
export type LiveHeartbeat = z.infer<typeof liveHeartbeatSchema>;

/** UID основного счёта для проверки AC3 — ответ приложения воркеру. */
export const liveMainAccountSchema = z.union([
  z.object({ uid: z.number() }),
  z.object({ uid: z.null(), reason: text }),
]);

/** Ответ на пульс. mainAccount нет — приложение не проверяло (фикстура, нет ключа). */
export const liveHeartbeatReplySchema = z.object({
  ok: z.literal(true),
  verdict: liveVerdictSchema,
  mainAccount: liveMainAccountSchema.optional(),
});
export type LiveHeartbeatReply = z.infer<typeof liveHeartbeatReplySchema>;

/** Последний пульс и состояние для уведомлений (таблица live_worker_state). */
export const liveStateSchema = z.object({
  heartbeat: liveHeartbeatSchema,
  receivedAt: isoTime,
  /** Оценка, о которой уже сообщили (журнал + Telegram). */
  status: liveVerdictSchema,
  statusSince: isoTime,
  /** Когда монитор записал «воркер молчит»; null — не молчит или ещё не замечено. */
  silentSince: isoTime.nullable(),
});
export type LiveState = z.infer<typeof liveStateSchema>;

/** Контракт GET /api/live/status — карточка «Реальный счёт». */
export const liveStatusResponseSchema = z.object({
  state: liveStateSchema.nullable(),
  silentAfterMs: z.number(),
});
export type LiveStatusResponse = z.infer<typeof liveStatusResponseSchema>;
