import { z } from "zod";
import { liveKeyFlagsSchema } from "@/shared/api/binance";
import { liveTradingSchema } from "./halt";

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
  /**
   * different — субсчёт; same — ключ основного счёта; skipped — у приложения нет read-only ключа (проверка
   * пропущена, ТЗ); pending — UID основного ещё не получен (рукопожатие после старта); unread — UID основного
   * не прочитан и не известен (блокировка, fail-closed).
   */
  status: z.enum(["different", "same", "skipped", "pending", "unread"]),
  note: text.nullable(),
});

// Не strictObject намеренно: лишние поля отрезаются, а не дают 400. Воркер (VM) и приложение (Vercel) выкатываются
// отдельно, и новый воркер с новым полем не должен получать отказ от старого приложения. В БД лишнее не попадает.
export const liveHeartbeatSchema = z.object({
  /** Версия воркера (сборка). */
  version: z.string().min(1).max(64),
  sentAt: isoTime,
  /**
   * Рукопожатие после старта воркера (spec 0049, nit ревью 0047): UID основного счёта ещё не получен — пульс только
   * запрашивает его, приложение такой пульс не сохраняет. Явный признак вместо распознавания по тексту причины.
   */
  handshake: z.boolean(),
  /**
   * Пульс фикстуры (локальная проверка); demo-venue — воркер в режиме «площадка демо» (тот же код, Binance Demo,
   * spec 0049); null — настоящий. Production такие пульсы не принимает.
   */
  fixture: z.enum([...LIVE_FIXTURES, "demo-venue"]).nullable(),
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

/**
 * UID основного счёта для проверки AC3 — ответ приложения воркеру. uid null: transient false — read-only ключа нет
 * (проверка пропускается), transient true — UID не прочитан сейчас (воркер держит последний известный, без него —
 * блокировка).
 */
export const liveMainAccountSchema = z.union([
  z.object({ uid: z.number() }),
  z.object({ uid: z.null(), reason: text, transient: z.boolean() }),
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
  /**
   * Оценка последнего пульса, о которой уже сообщили (журнал + Telegram) — не «что сейчас»: молчание в ней не
   * отражается, его даёт deriveLiveStatus / поле current ответа.
   */
  status: liveVerdictSchema,
  statusSince: isoTime,
  /** Когда монитор записал «воркер молчит»; null — не молчит или ещё не замечено. */
  silentSince: isoTime.nullable(),
});
export type LiveState = z.infer<typeof liveStateSchema>;

/**
 * Что показывать сейчас (deriveLiveStatus): «молчит» важнее оценки последнего пульса. В отличие от state.status —
 * оценки, о которой уже сообщили (для уведомлений без повторов), — учитывает время без пульса.
 */
export const liveStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("not-connected") }),
  /** Пульса нет дольше порога: since — время последнего пульса. */
  z.object({ kind: z.literal("silent"), since: isoTime }),
  z.object({ kind: z.literal("no-key") }),
  z.object({ kind: z.literal("blocked"), reasons: z.array(text) }),
  z.object({ kind: z.literal("ok"), warnings: z.array(text) }),
]);
export type LiveStatus = z.infer<typeof liveStatusSchema>;

/** Контракт GET /api/live/status — карточка «Реальный счёт». */
export const liveStatusResponseSchema = z.object({
  state: liveStateSchema.nullable(),
  silentAfterMs: z.number(),
  /** Состояние на момент ответа (сервер считает той же deriveLiveStatus, что карточка и шапка). */
  current: liveStatusSchema,
  /** Торговля реального счёта (spec 0049): стоп, позиции, дневные лимиты экспериментов. */
  trading: liveTradingSchema,
});
export type LiveStatusResponse = z.infer<typeof liveStatusResponseSchema>;
