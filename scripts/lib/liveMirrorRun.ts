// Прогон реального зеркала в воркере (spec 0049): тот же runMirror, что у демо-зеркала (features/demo-mirror), но
// биржа — площадка реального счёта (клиент Live с белым списком), а хранилище — API приложения /api/live/mirror/*
// (у воркера нет БД). Проверки входа — createLiveGate (features/live-mirror): стоп, 5 позиций, дневной лимит
// эксперимента, объём $10, средства. Сеть и API внедряются — прогон покрыт тестами без биржи и приложения.
import type { z } from "zod";
import {
  type LiveCloseRequest,
  type LiveLegsRequest,
  type LiveMirrorState,
  type LiveOpenRequest,
  type LiveToClose,
  liveClaimCloseReplySchema,
  liveClaimReplySchema,
  liveCloseAllReplySchema,
  liveMirrorStateSchema,
  liveOkSchema,
} from "@/entities/experiment";
import {
  createLiveGate,
  type FillLike,
  fillsPnl,
  LIVE,
  LIVE_SKIP,
  liveUsd,
} from "@/entities/live-account";
import type { TradeRequest, TradeResult } from "@/entities/trade";
import {
  type MirrorDecision,
  type MirrorPlanPolicy,
  type MirrorRunResult,
  runMirror,
} from "@/features/demo-mirror";
import type {
  CloseDemoRequest,
  EntrySize,
  OpenMirrorLegs,
  SweptMirror,
} from "@/features/execute-trade";

type Market = "spot" | "usdm";

/** Реальное зеркало: одна позиция на монету рынка, свои тексты пропусков. */
export const LIVE_MIRROR_POLICY: MirrorPlanPolicy = {
  maxPerCoin: 1,
  marketName: { spot: "реальном споте", usdm: "реальных фьючерсах" },
  name: "реальное зеркало",
  coinBusy: () => LIVE_SKIP.coin,
};

/** Маршруты API приложения для воркера (Bearer LIVE_WORKER_SECRET). */
export type MirrorPost = <T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
) => Promise<z.infer<T>>;

export function mirrorApi(post: MirrorPost) {
  return {
    state: () => post("/api/live/mirror/state", {}, liveMirrorStateSchema),
    claim: (tradeId: string) =>
      post("/api/live/mirror/claim", { tradeId }, liveClaimReplySchema),
    skip: (tradeId: string, reason: string) =>
      post("/api/live/mirror/skip", { tradeId, reason }, liveOkSchema),
    open: (body: LiveOpenRequest) =>
      post("/api/live/mirror/open", body, liveOkSchema),
    claimClose: async (tradeId: string) =>
      (
        await post(
          "/api/live/mirror/claim-close",
          { tradeId },
          liveClaimCloseReplySchema,
        )
      ).item,
    close: (body: LiveCloseRequest) =>
      post("/api/live/mirror/close", body, liveOkSchema),
    legs: (body: LiveLegsRequest) =>
      post("/api/live/mirror/legs", body, liveOkSchema),
    closeAllClaim: async () =>
      (
        await post(
          "/api/live/mirror/close-all",
          { phase: "claim" },
          liveCloseAllReplySchema,
        )
      ).items,
    closeAllDone: (r: { closed: number; failed: number; errors: string[] }) =>
      post("/api/live/mirror/close-all", { phase: "done", ...r }, liveOkSchema),
  };
}
export type MirrorApi = ReturnType<typeof mirrorApi>;

/** Биржа реального счёта для прогона (площадка Live): ордера — общая логика execute-trade. */
export interface LiveExchange {
  placeTrade: (req: TradeRequest) => Promise<TradeResult>;
  closePosition: (req: CloseDemoRequest) => Promise<{
    status: "closed" | "failed";
    message: string;
    steps: { label: string; ok: boolean; detail: string }[];
    exitPrice: number | null;
    /** Свои TP/SL в этой попытке сняты (closeDemoPosition). */
    protectionRemoved?: boolean;
  }>;
  sweepLegs: (
    legs: OpenMirrorLegs[],
    overBudget: () => boolean,
  ) => Promise<SweptMirror[]>;
  /** Правила символа; null — символа нет на рынке. */
  symbolRules: (
    market: Market,
    symbol: string,
  ) => Promise<{
    minQty: number;
    minNotional: number;
    stepSize: string;
  } | null>;
  price: (market: Market, symbol: string) => Promise<number>;
  balances: () => Promise<{ spot: number; usdm: number }>;
  positionMode: () => Promise<"oneway" | "hedge">;
  /** Счёт фьючерсов пуст (нет позиций и ордеров) — можно переключить режим. */
  futuresBusy: () => Promise<boolean>;
  enableOneway: () => Promise<unknown>;
  fills: (market: Market, symbol: string) => Promise<FillLike[]>;
  sizeEntry: (input: {
    price: number;
    rules: { minQty: number; minNotional: number; stepSize: string };
    targetUsd: number;
    maxUsd: number;
    spotStop: number | null;
  }) => EntrySize;
  spotSlippage: number;
}

/** «Остаток 0.00000986 BTC ≈ $0,81 остался на субсчёте». */
const leftoverText = (l: { qty: number; asset: string; usd: number }) =>
  `Остаток ${l.qty.toFixed(8).replace(/\.?0+$/, "")} ${l.asset} ≈ ${liveUsd(l.usd)} остался на субсчёте`;

/** Исполнения ищем с запасом до создания строки: вход отправляется сразу после захвата. */
const FILLS_SLACK_MS = 60_000;

/** Чем закрыта позиция по пути закрытия: биржа (TP/SL — по знаку PnL) или само зеркало. */
export function closedByOf(
  message: string,
  realizedPnl: number | null,
  fallback: "mirror" | "close_all",
): LiveCloseRequest["exit"]["closedBy"] {
  if (/сработал (TP\/SL|стоп\/тейк)/.test(message) && realizedPnl !== null)
    return realizedPnl >= 0 ? "tp" : "sl";
  return fallback;
}

async function exitByFills(
  ex: LiveExchange,
  item: Pick<LiveToClose, "market" | "symbol" | "direction" | "openedAt">,
  fallbackExit: number | null,
): Promise<{
  exitPrice: number | null;
  feesUsd: number | null;
  realizedPnl: number | null;
  leftover: LiveCloseRequest["exit"]["leftover"];
  note: string | null;
}> {
  const asset = item.symbol.replace(/USDT$/, "");
  try {
    const pnl = fillsPnl(await ex.fills(item.market, item.symbol), {
      direction: item.direction,
      since: Date.parse(item.openedAt) - FILLS_SLACK_MS,
      baseAsset: asset,
    });
    const leftover =
      pnl.leftoverQty > 0
        ? { qty: pnl.leftoverQty, asset, usd: pnl.leftoverUsd }
        : null;
    const notes = [
      leftover ? `${leftoverText(leftover)} — в PnL не входит.` : null,
      pnl.unpricedFees.length
        ? `Комиссии в ${pnl.unpricedFees.join(", ")} в $ не пересчитаны.`
        : null,
    ].filter(Boolean);
    return {
      exitPrice: pnl.exitPrice ?? fallbackExit,
      feesUsd: pnl.feesUsd,
      realizedPnl: pnl.realizedPnl,
      leftover,
      note: notes.join(" ") || null,
    };
  } catch (error) {
    return {
      exitPrice: fallbackExit,
      feesUsd: null,
      realizedPnl: null,
      leftover: null,
      note: `Исполнения не прочитаны — PnL не посчитан: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Одна попытка закрыть реальную позицию. Не вышло — status failed (строка вернётся в очередь и повторится на
 * следующем прогоне); исключение биржи — тоже failed, а не обрыв прогона. protectionRemoved — свои TP/SL в этой
 * попытке уже сняты: позиция без защиты до следующей попытки.
 */
export async function closeOne(
  ex: LiveExchange,
  item: LiveToClose,
  fallback: "mirror" | "close_all",
): Promise<LiveCloseRequest> {
  let r: Awaited<ReturnType<LiveExchange["closePosition"]>>;
  try {
    r = await ex.closePosition(item);
  } catch (error) {
    r = {
      status: "failed",
      message: `Закрытие не удалось: ${error instanceof Error ? error.message : String(error)}`,
      steps: [],
      exitPrice: null,
    };
  }
  const fills =
    r.status === "closed"
      ? await exitByFills(ex, item, r.exitPrice)
      : {
          exitPrice: null,
          feesUsd: null,
          realizedPnl: null,
          leftover: null,
          note: null,
        };
  return {
    tradeId: item.tradeId,
    status: r.status,
    protectionRemoved: r.status === "failed" && r.protectionRemoved === true,
    exit: {
      message: fills.note ? `${r.message} ${fills.note}` : r.message,
      steps: r.steps,
      exitPrice: fills.exitPrice,
      feesUsd: fills.feesUsd,
      realizedPnl: fills.realizedPnl,
      leftover: fills.leftover,
      closedBy:
        r.status === "closed"
          ? closedByOf(r.message, fills.realizedPnl, fallback)
          : null,
    },
  };
}

/**
 * «Закрыть всё»: захватить все открытые реальные позиции (и не закрывшиеся раньше), закрыть по рынку, сообщить итог.
 * Остались позиции — приложение держит запрос, следующий прогон повторяет.
 */
export async function runCloseAll(
  api: MirrorApi,
  ex: LiveExchange,
): Promise<{ closed: number; failed: number; errors: string[] }> {
  const items = await api.closeAllClaim();
  let closed = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const item of items) {
    const body = await closeOne(ex, item, "close_all");
    await api.close(body);
    if (body.status === "closed") closed++;
    else {
      failed++;
      errors.push(`${item.symbol}: ${body.exit.message}`);
    }
  }
  const result = { closed, failed, errors };
  await api.closeAllDone(result);
  return result;
}

/**
 * Режим реальных фьючерсов: One-way — можно входить. Hedge — переключить, только если счёт пуст; иначе входы на
 * фьючерсах пропускаются. Не узнали — null (кандидаты ждут).
 */
export async function ensureOneway(
  ex: LiveExchange,
): Promise<"oneway" | "hedge" | null> {
  try {
    const mode = await ex.positionMode();
    if (mode === "oneway") return mode;
    if (await ex.futuresBusy()) return "hedge";
    await ex.enableOneway();
    return "oneway";
  } catch {
    return null;
  }
}

export interface LiveMirrorRunInput {
  api: MirrorApi;
  ex: LiveExchange;
  now: () => number;
  /** Оценка ключа в этом пульсе: годится — входы и закрытия; нет — только «Закрыть всё» (если ключ принят). */
  verdictOk: boolean;
  /** Binance принимает ключ (не -2015 / 401): «Закрыть всё» можно и при заблокированном ключе. */
  keyAccepted: boolean;
}

export interface LiveMirrorRunSummary {
  closeAll: { closed: number; failed: number; errors: string[] } | null;
  run: MirrorRunResult | null;
}

/** Один прогон реального зеркала. Состояние приложения не прочитано — исключение: ничего не открывается. */
export async function runLiveMirror(
  input: LiveMirrorRunInput,
): Promise<LiveMirrorRunSummary> {
  const { api, ex } = input;
  const state: LiveMirrorState = await api.state();
  let closeAll: LiveMirrorRunSummary["closeAll"] = null;
  if (state.halt.closeAllRequested && input.keyAccepted)
    closeAll = await runCloseAll(api, ex);
  // Ключ не прошёл проверку прав — ни входов, ни закрытий, кроме «Закрыть всё» (AC9).
  if (!input.verdictOk) return { closeAll, run: null };

  const candidates = new Map(state.candidates.map((c) => [c.tradeId, c]));
  const requests = new Map<
    string,
    {
      request: Extract<MirrorDecision, { kind: "open" }>["request"];
      size: EntrySize;
    }
  >();
  const sizes = new Map<string, EntrySize>();
  // Итог закрытия с PnL по исполнениям — между close и saveClose (runMirror передаёт только общие поля).
  const closes = new Map<string, LiveCloseRequest>();
  const gate = createLiveGate({
    halted: state.halt.stopped,
    openCount: state.active.length,
    dailyPnl: new Map(Object.entries(state.dailyPnl)),
    experimentOf: (tradeId) => candidates.get(tradeId)?.experimentId,
    futuresMode: () => ensureOneway(ex),
    size: async (d) => {
      const rules = await ex.symbolRules(d.request.market, d.request.symbol);
      if (!rules) return { ok: false, minUsd: Number.POSITIVE_INFINITY };
      const size = ex.sizeEntry({
        price: await ex.price(d.request.market, d.request.symbol),
        rules,
        targetUsd: LIVE.notionalUsd,
        maxUsd: LIVE.maxNotionalUsd,
        spotStop: d.request.market === "spot" ? d.request.stopLoss : null,
      });
      sizes.set(d.tradeId, size);
      return size;
    },
    freeUsd: async (market) => (await ex.balances())[market],
    spotSlippage: ex.spotSlippage,
  });

  const run = await runMirror({
    now: input.now,
    configured: true,
    policy: LIVE_MIRROR_POLICY,
    listCandidates: async () => state.candidates,
    activeMirrors: async () =>
      state.active.map((a) => ({
        market: a.market,
        symbol: a.symbol,
        direction: a.direction,
        hasRefs: true,
      })),
    positionMode: async () => (await ensureOneway(ex)) ?? "oneway",
    hasSymbol: async (market, symbol) =>
      (await ex.symbolRules(market, symbol)) !== null,
    freeUsd: async (market) => (await ex.balances())[market],
    gate: {
      check: async (d) => {
        const r = await gate.check(d);
        if (r?.kind === "open") {
          const size = sizes.get(r.tradeId);
          if (size) requests.set(r.tradeId, { request: r.request, size });
        }
        return r;
      },
      spend: (d) => gate.spend(d),
    },
    // Пропуск пишется одной вставкой в markSkipped; вход — атомарный захват в БД (стоп перепроверяется там же).
    claim: async (tradeId, kind) =>
      kind === "skip" ? true : (await api.claim(tradeId)).claimed,
    open: (req) => ex.placeTrade(req),
    markSkipped: async (tradeId, reason) => {
      await api.skip(tradeId, reason);
    },
    saveOpen: async (tradeId, r) => {
      const sent = requests.get(tradeId);
      const size = sent?.size;
      await api.open({
        tradeId,
        result: {
          id: r.id,
          status: r.status,
          message: r.message,
          entryPrice: r.entryPrice,
          filledQuantity: r.filledQuantity,
          steps: r.steps,
          protectRefs: r.protectRefs ?? null,
        },
        order: {
          stopLoss: sent?.request.stopLoss ?? 0,
          takeProfit: sent?.request.stopOnly
            ? null
            : (sent?.request.takeProfit ?? null),
          notionalUsd:
            r.entryPrice !== null && r.filledQuantity !== null
              ? r.entryPrice * r.filledQuantity
              : size?.ok
                ? size.notionalUsd
                : 0,
          raised: size?.ok ? size.raised : null,
        },
      });
    },
    sweepLegs: async (overBudget) => {
      const swept = await ex.sweepLegs(state.openLegs, overBudget);
      if (!swept.length) return [];
      const items: LiveLegsRequest["items"] = [];
      for (const m of swept) {
        const active = state.active.find((a) => a.tradeId === m.tradeId);
        const fills =
          m.status === "closed" && active
            ? await exitByFills(
                ex,
                {
                  market: "usdm",
                  symbol: m.symbol,
                  direction: active.direction,
                  openedAt: active.openedAt,
                },
                m.exitPrice,
              )
            : null;
        items.push({
          tradeId: m.tradeId,
          outcome: m.status,
          exit: {
            message: fills?.note ? `${m.message} ${fills.note}` : m.message,
            steps: m.steps,
            exitPrice: fills?.exitPrice ?? m.exitPrice,
            feesUsd: fills?.feesUsd ?? null,
            realizedPnl: fills?.realizedPnl ?? null,
            leftover: fills?.leftover ?? null,
            closedBy: m.closedBy === "stop" ? "sl" : "tp",
          },
        });
      }
      await api.legs({ items });
      return swept
        .filter((m) => m.status === "closed")
        .map((m) => ({ tradeId: m.tradeId, symbol: m.symbol }));
    },
    listToClose: async () => state.toClose,
    claimToClose: (tradeId) => api.claimClose(tradeId),
    close: async (item) => {
      const body = await closeOne(ex, item, "mirror");
      closes.set(item.tradeId, body);
      return {
        status: body.status,
        message: body.exit.message,
        steps: body.exit.steps,
        exitPrice: body.exit.exitPrice,
      };
    },
    saveClose: async (tradeId) => {
      const body = closes.get(tradeId);
      if (body) await api.close(body);
    },
  });
  return { closeAll, run };
}
