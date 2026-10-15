import type { MirrorOrderRequest } from "../lib/planMirror";
import {
  listingKey,
  type MirrorListing,
  type MirrorTradeInput,
  planMirror,
} from "../lib/planMirror";

// Прогон demo-зеркала (spec 008). Хранилище и биржа — зависимости: их собирает
// src/app/server/demoMirror.ts (feature не импортирует feature execute-trade).

export interface MirrorStep {
  label: string;
  ok: boolean;
  detail: string;
}

export interface MirrorDeps {
  now: () => number;
  /** Ключ Binance Demo задан — иначе прогон ничего не делает. */
  configured: boolean;
  listCandidates: (since: Date) => Promise<MirrorTradeInput[]>;
  busySymbols: () => Promise<Set<string>>;
  /**
   * Есть ли символ на демо-рынке: false — точно нет (вход пропускается), исключение — сеть
   * (кандидат ждёт следующего прогона). Проверяется до захвата сделки и запроса на вход.
   */
  hasSymbol: (market: "spot" | "futures", symbol: string) => Promise<boolean>;
  /** Захват сделки (вставка pending). false — её уже взял другой прогон. */
  claim: (tradeId: string) => Promise<boolean>;
  open: (req: MirrorOrderRequest) => Promise<{
    id: string;
    status: "protected" | "unprotected" | "rejected";
    message: string;
    entryPrice: number | null;
    filledQuantity: number | null;
    steps: MirrorStep[];
  }>;
  /** Отметить захваченную сделку пропущенной (не открывалась). */
  markSkipped: (tradeId: string, reason: string) => Promise<void>;
  saveOpen: (
    tradeId: string,
    result: Awaited<ReturnType<MirrorDeps["open"]>>,
  ) => Promise<void>;
  claimToClose: () => Promise<
    {
      tradeId: string;
      market: "spot" | "futures";
      symbol: string;
      direction: "long" | "short";
      quantity: number;
    }[]
  >;
  close: (req: {
    market: "spot" | "futures";
    symbol: string;
    direction: "long" | "short";
    quantity: number;
  }) => Promise<{
    status: "closed" | "failed";
    message: string;
    steps: MirrorStep[];
    exitPrice: number | null;
  }>;
  saveClose: (
    tradeId: string,
    result: Awaited<ReturnType<MirrorDeps["close"]>>,
  ) => Promise<void>;
}

export interface MirrorRunResult {
  configured: boolean;
  opened: { tradeId: string; symbol: string; status: string }[];
  skipped: number;
  closed: { tradeId: string; symbol: string; status: string }[];
}

/**
 * Один прогон: сначала закрыть демо-позиции закрытых paper-сделок (освобождает символы),
 * затем открыть зеркала свежих входов. Сделка «захватывается» до запроса к бирже —
 * параллельный прогон её не повторит.
 */
export async function runMirror(deps: MirrorDeps): Promise<MirrorRunResult> {
  const result: MirrorRunResult = {
    configured: deps.configured,
    opened: [],
    skipped: 0,
    closed: [],
  };
  if (!deps.configured) return result;

  for (const m of await deps.claimToClose()) {
    const r = await deps.close(m);
    await deps.saveClose(m.tradeId, r);
    result.closed.push({
      tradeId: m.tradeId,
      symbol: m.symbol,
      status: r.status,
    });
  }

  const now = deps.now();
  const candidates = await deps.listCandidates(new Date(now - 60 * 60_000));
  const decisions = planMirror(
    candidates,
    await deps.busySymbols(),
    now,
    await checkListing(deps, candidates),
  );
  for (const d of decisions) {
    if (!(await deps.claim(d.tradeId))) continue;
    if (d.kind === "skip") {
      await deps.markSkipped(d.tradeId, d.reason);
      result.skipped++;
      continue;
    }
    const r = await deps.open(d.request);
    await deps.saveOpen(d.tradeId, r);
    result.opened.push({
      tradeId: d.tradeId,
      symbol: d.request.symbol,
      status: r.status,
    });
  }
  return result;
}

/** Проверка символов кандидатов на демо: по разу на market:symbol. */
async function checkListing(
  deps: Pick<MirrorDeps, "hasSymbol">,
  candidates: MirrorTradeInput[],
): Promise<MirrorListing> {
  const listing: MirrorListing = { missing: new Set(), unknown: new Set() };
  const seen = new Set<string>();
  for (const t of candidates) {
    const k = listingKey(t);
    if (seen.has(k) || !t.symbol.endsWith("USDT")) continue;
    seen.add(k);
    try {
      if (!(await deps.hasSymbol(t.market, t.symbol))) listing.missing.add(k);
    } catch {
      listing.unknown.add(k);
    }
  }
  return listing;
}
