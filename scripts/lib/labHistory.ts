// История Binance для бэктеста лаборатории (spec 0032): свечи, ставки funding и список торгуемых сейчас символов.
// Свечи в БД не храним (история Binance неизменна) — дисковый кэш вне git по (рынок, символ, интервал, месяц):
// повторный прогон того же периода ничего не скачивает, новый — догружает только недостающие куски.
// Загрузка — публичный API без ключей: лимитер веса по хосту, пауза и повтор на 429/418, повторы сетевых сбоев.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type Candle,
  type ExperimentMarket,
  TIMEFRAME_MS,
} from "@binance-dashboard/trading-core";
import { z } from "zod";
import { type Interval, isEligibleSymbol } from "@/features/paper-engine";
import { createMarketApi } from "@/shared/api/binance/marketApi";

const MINUTE = 60_000;

export const INTERVAL_MS: Record<Interval, number> = {
  ...TIMEFRAME_MS,
  "1m": MINUTE,
};

/** Свеча истории: плюс оборот в котировке (Spot, USDⓈ-M — USDT; COIN-M — контракты, в $ переводит размер контракта). */
export interface HistoryCandle extends Candle {
  quoteVolume: number;
}

export interface FundingPoint {
  /** Время выплаты, мс. */
  time: number;
  /** Ставка за период (доля). */
  rate: number;
}

export interface MarketSymbol {
  symbol: string;
  /** COIN-M: размер контракта в $. */
  contractSize?: number;
}

/** Источник истории для бэктеста: диск + Binance (createDiskHistory) или синтетика в тестах. */
export interface BacktestHistory {
  /** Символы группы, торгуемые сейчас (без стейблов и не-крипто); snapshotAt — когда снят список. */
  symbols(
    market: ExperimentMarket,
  ): Promise<{ symbols: MarketSymbol[]; snapshotAt: number }>;
  /** Свечи с openTime в [from, to), закрытые на момент загрузки, по возрастанию. */
  klines(
    market: ExperimentMarket,
    symbol: string,
    interval: Interval,
    from: number,
    to: number,
  ): Promise<HistoryCandle[]>;
  /** Выплаты funding в [from, to), по возрастанию. */
  funding(
    market: ExperimentMarket,
    symbol: string,
    from: number,
    to: number,
  ): Promise<FundingPoint[]>;
}

/** Данных нет в кэше, а загрузка выключена (`--no-download`). */
export class NotCachedError extends Error {}

// --- Месяцы и покрытие кэша ---

/** Часть диапазона [from, to) внутри одного UTC-месяца. */
export interface MonthPart {
  /** YYYY-MM. */
  month: string;
  from: number;
  to: number;
}

/** Диапазон [from, to) по UTC-месяцам. */
export function monthParts(from: number, to: number): MonthPart[] {
  const parts: MonthPart[] = [];
  let cursor = from;
  while (cursor < to) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    parts.push({
      month: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      from: cursor,
      to: Math.min(next, to),
    });
    cursor = next;
  }
  return parts;
}

/** Покрытие файла месяца: [from, to) — непрерывно; всё, что внутри, уже загружено. */
export interface Coverage {
  from: number;
  to: number;
}

/**
 * Чего не хватает, чтобы покрыть [from, to), сохранив покрытие непрерывным: кусок до покрытия и кусок после
 * (вместе с разрывом, если запрос с ним не пересекается). Покрытия нет — весь диапазон.
 */
export function missingRanges(
  have: Coverage | null,
  from: number,
  to: number,
): [number, number][] {
  if (from >= to) return [];
  if (!have) return [[from, to]];
  const out: [number, number][] = [];
  if (from < have.from) out.push([from, have.from]);
  if (to > have.to) out.push([have.to, to]);
  return out;
}

/** Склеить соседние куски [a, b) [b, c) → [a, c): меньше запросов на границах месяцев. */
export function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// --- Лимитер веса и повторы ---

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

/**
 * Скользящее окно веса: не больше capacity за windowMs. Запросы ждут в порядке очереди. Один запрос тяжелее
 * всего окна проходит, когда окно пусто.
 */
export function createWeightLimiter(
  capacity: number,
  windowMs: number,
  clock: Clock = realClock,
) {
  const spent: { at: number; weight: number }[] = [];
  let queue: Promise<void> = Promise.resolve();
  const used = (now: number) => {
    while (spent.length && spent[0].at <= now - windowMs) spent.shift();
    return spent.reduce((s, x) => s + x.weight, 0);
  };
  return {
    acquire(weight: number): Promise<void> {
      const run = queue.then(async () => {
        for (;;) {
          const now = clock.now();
          if (spent.length === 0 || used(now) + weight <= capacity) {
            spent.push({ at: now, weight });
            return;
          }
          await clock.sleep(spent[0].at + windowMs - now + 1);
        }
      });
      queue = run.catch(() => {});
      return run;
    },
    used: () => used(clock.now()),
  };
}

export type WeightLimiter = ReturnType<typeof createWeightLimiter>;

/** Сколько запросов одновременно. */
function createSemaphore(size: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= size) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** Ответ HTTP — то, что нужно транспорту от fetch. */
export interface HttpResponse {
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export type FetchLike = (url: string) => Promise<HttpResponse>;

/** Пауза после 429/418: Retry-After (сек) или «banned until <ms>» из тела, иначе минута. */
export function cooldownMs(
  now: number,
  retryAfter: string | null,
  body: unknown,
): number {
  const seconds = Number(retryAfter);
  let wait =
    retryAfter && Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : 60_000;
  const msg = (body as { msg?: unknown } | null)?.msg;
  const banned =
    typeof msg === "string" ? /banned until (\d{13})/.exec(msg) : null;
  if (banned) wait = Math.max(wait, Number(banned[1]) - now);
  return wait;
}

/** Бан дольше этого не пережидаем — прогон останавливается с понятной ошибкой. */
export const MAX_COOLDOWN_MS = 10 * 60_000;
/** Паузы перед повторами сетевых сбоев и 5xx. */
export const NETWORK_RETRY_MS = [1_000, 3_000, 10_000] as const;
/** 429/418 подряд — не больше стольких пауз на запрос. */
export const COOLDOWN_RETRIES = 3;

export class HttpStatusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface TransportOptions {
  fetch: FetchLike;
  clock?: Clock;
  /** Сообщения о паузах и повторах — в консоль скрипта. */
  onNotice?: (message: string) => void;
}

/**
 * GET JSON с паузой на 429/418 (общей для хоста: параллельные запросы тоже ждут) и повторами сетевых сбоев и 5xx.
 * Ошибка 4xx (кроме 429/418) не повторяется.
 */
export function createTransport(opts: TransportOptions) {
  const clock = opts.clock ?? realClock;
  const pausedUntil = new Map<string, number>();
  const waitPause = async (host: string) => {
    for (;;) {
      const until = pausedUntil.get(host) ?? 0;
      const now = clock.now();
      if (now >= until) return;
      await clock.sleep(until - now);
    }
  };
  return async (url: string): Promise<unknown> => {
    const host = new URL(url).host;
    let cooldowns = 0;
    let failures = 0;
    for (;;) {
      await waitPause(host);
      let res: HttpResponse;
      try {
        res = await opts.fetch(url);
      } catch (error) {
        const delay = NETWORK_RETRY_MS[failures++];
        if (delay === undefined) throw error;
        opts.onNotice?.(
          `сбой сети (${error instanceof Error ? error.message : error}), повтор через ${delay / 1000} с`,
        );
        await clock.sleep(delay);
        continue;
      }
      if (res.status === 429 || res.status === 418) {
        const body = await res.json().catch(() => null);
        const wait = cooldownMs(
          clock.now(),
          res.headers.get("retry-after"),
          body,
        );
        if (wait > MAX_COOLDOWN_MS || ++cooldowns > COOLDOWN_RETRIES)
          throw new HttpStatusError(
            `${host}: ответ ${res.status}, пауза ${Math.round(wait / 1000)} с — остановлено, повторите позже`,
            res.status,
          );
        pausedUntil.set(
          host,
          Math.max(pausedUntil.get(host) ?? 0, clock.now() + wait),
        );
        opts.onNotice?.(
          `${host}: ответ ${res.status} (лимит веса), пауза ${Math.round(wait / 1000)} с`,
        );
        continue;
      }
      if (res.status >= 500) {
        const delay = NETWORK_RETRY_MS[failures++];
        if (delay === undefined)
          throw new HttpStatusError(`${host}: ответ ${res.status}`, res.status);
        await clock.sleep(delay);
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        const body = await res.json().catch(() => null);
        throw new HttpStatusError(
          `${url}: ответ ${res.status} ${JSON.stringify(body)}`,
          res.status,
        );
      }
      return res.json();
    }
  };
}

// --- Binance: пути, веса, разбор ---

const BASE: Record<ExperimentMarket, string> = {
  spot: "https://api.binance.com/api/v3",
  usdm: "https://fapi.binance.com/fapi/v1",
  coinm: "https://dapi.binance.com/dapi/v1",
};

/** Лимит веса в минуту на IP (документация Binance, 2026-10): Spot — 6000, USDⓈ-M и COIN-M — 2400. */
export const WEIGHT_PER_MINUTE: Record<ExperimentMarket, number> = {
  spot: 6000,
  usdm: 2400,
  coinm: 2400,
};
/** Доля лимита, которую берёт бэктест: остальное — живому движку и дашборду на том же IP. */
export const WEIGHT_SHARE = 0.6;
/** fundingRate: отдельный лимит 500 запросов за 5 минут на IP (общий с fundingInfo). */
export const FUNDING_LIMIT = { requests: 500, windowMs: 5 * 60_000 } as const;

/** Свечей за запрос: Spot — 1000 (вес 2); фьючерсы — 499 (вес 2; 500–1000 весят 5, выгоднее страницы по 499). */
export const KLINES_PAGE: Record<ExperimentMarket, number> = {
  spot: 1000,
  usdm: 499,
  coinm: 499,
};

/** Вес запроса свечей: Spot — 2; фьючерсы — по limit: < 100 — 1, < 500 — 2, ≤ 1000 — 5, больше — 10. */
export function klinesWeight(market: ExperimentMarket, limit: number): number {
  if (market === "spot") return 2;
  if (limit < 100) return 1;
  if (limit < 500) return 2;
  if (limit <= 1000) return 5;
  return 10;
}

/** Строка свечи Binance: [openTime, open, high, low, close, volume, closeTime, quoteVolume, …]. */
const rawKlineSchema = z.array(
  z
    .tuple([
      z.number(),
      z.coerce.number(),
      z.coerce.number(),
      z.coerce.number(),
      z.coerce.number(),
      z.coerce.number(),
      z.number(),
      z.coerce.number(),
    ])
    .rest(z.unknown()),
);

const rawFundingSchema = z.array(
  z.object({
    fundingTime: z.number(),
    fundingRate: z.coerce.number(),
  }),
);

/**
 * Свечи Binance → история. Оборот: Spot и USDⓈ-M — quoteVolume (USDT); COIN-M — volume (контракты): в $ его
 * переводит размер контракта при расчёте тикера, как у живого coinmTicker.
 */
export function parseKlines(
  raw: unknown,
  market: ExperimentMarket,
): HistoryCandle[] {
  return rawKlineSchema
    .parse(raw)
    .map(([openTime, open, high, low, close, volume, , quoteVolume]) => ({
      openTime,
      open,
      high,
      low,
      close,
      volume,
      quoteVolume: market === "coinm" ? volume : quoteVolume,
    }));
}

// --- Кэш на диске ---

/** Файл месяца: покрытие и строки. Свеча — [openTime, open, high, low, close, volume, quoteVolume]. */
const monthFileSchema = z.object({
  from: z.number(),
  to: z.number(),
  rows: z.array(z.array(z.number())),
});
type MonthFile = z.infer<typeof monthFileSchema>;

const symbolsFileSchema = z.object({
  at: z.number(),
  symbols: z.array(
    z.object({ symbol: z.string(), contractSize: z.number().optional() }),
  ),
});

const toRow = (c: HistoryCandle) => [
  c.openTime,
  c.open,
  c.high,
  c.low,
  c.close,
  c.volume,
  c.quoteVolume,
];
const fromRow = (r: number[]): HistoryCandle => ({
  openTime: r[0],
  open: r[1],
  high: r[2],
  low: r[3],
  close: r[4],
  volume: r[5],
  quoteVolume: r[6],
});

/** Счётчики загрузки — для прогресса и шапки отчёта. */
export interface HistoryStats {
  requests: number;
  weight: number;
  /** Запросы, которые ответил кэш целиком. */
  cacheHits: number;
}

export interface DiskHistoryOptions {
  /** Корень кэша: <root>/klines/<рынок>/<интервал>/<символ>/<YYYY-MM>.json, <root>/funding/…, <root>/symbols/…. */
  root: string;
  /** Только кэш: недостающие данные — NotCachedError. */
  noDownload?: boolean;
  fetch?: FetchLike;
  clock?: Clock;
  /** Одновременных запросов к Binance. */
  concurrency?: number;
  onNotice?: (message: string) => void;
  /** Каждый сделанный запрос — для прогресса. */
  onRequest?: (stats: HistoryStats, label: string) => void;
}

/** Только закрытые к fetchedAt свечи: незакрытая свеча меняется и в кэш не попадает. */
const closedBy = (fetchedAt: number, ms: number) => (c: HistoryCandle) =>
  c.openTime + ms <= fetchedAt;

/**
 * История с дисковым кэшем. Покрытие месяца непрерывно: запрос внутри покрытия — из кэша, иначе догружаются
 * только недостающие куски (соседние месяцы — одной серией запросов). Незакрытые на момент загрузки свечи и
 * ещё не наступившие выплаты funding в кэш не пишутся, покрытие обрезается по времени загрузки.
 */
export function createDiskHistory(opts: DiskHistoryOptions): BacktestHistory & {
  stats: HistoryStats;
} {
  const clock = opts.clock ?? realClock;
  const getJson = createTransport({
    fetch:
      opts.fetch ??
      ((url) =>
        fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(20_000),
        })),
    clock,
    onNotice: opts.onNotice,
  });
  const limiters = Object.fromEntries(
    (Object.keys(BASE) as ExperimentMarket[]).map((m) => [
      m,
      createWeightLimiter(
        Math.floor(WEIGHT_PER_MINUTE[m] * WEIGHT_SHARE),
        60_000,
        clock,
      ),
    ]),
  ) as Record<ExperimentMarket, WeightLimiter>;
  const fundingLimiter = createWeightLimiter(
    Math.floor(FUNDING_LIMIT.requests * 0.8),
    FUNDING_LIMIT.windowMs,
    clock,
  );
  const slot = createSemaphore(opts.concurrency ?? 8);
  const stats: HistoryStats = { requests: 0, weight: 0, cacheHits: 0 };

  const request = (
    limiter: WeightLimiter,
    weight: number,
    url: string,
    label: string,
  ) =>
    slot(async () => {
      await limiter.acquire(weight);
      const data = await getJson(url);
      stats.requests++;
      stats.weight += weight;
      opts.onRequest?.(stats, label);
      return data;
    });

  const noDownload = (what: string) => {
    throw new NotCachedError(
      `нет в кэше (${opts.root}): ${what} — запустите без --no-download`,
    );
  };

  // Запись и чтение месяца — последовательно на файл: параллельные запросы одного ряда не теряют строки.
  const fileLocks = new Map<string, Promise<unknown>>();
  const locked = <T>(file: string, task: () => Promise<T>): Promise<T> => {
    const prev = fileLocks.get(file) ?? Promise.resolve();
    const run = prev.then(task, task);
    fileLocks.set(
      file,
      run.catch(() => {}),
    );
    return run;
  };

  const readMonth = async (file: string): Promise<MonthFile | null> => {
    try {
      return monthFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
    } catch {
      return null;
    }
  };
  const writeJson = async (file: string, value: unknown) => {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(value));
    await rename(tmp, file);
  };

  /**
   * Ряд (свечи или funding) в [from, to): месяцы из кэша, недостающее — download(a, b) одной серией на соседние
   * куски. download возвращает строки и докуда данные окончательны (время загрузки).
   */
  async function ranged(
    dir: string,
    what: string,
    from: number,
    to: number,
    timeOf: (row: number[]) => number,
    download: (
      a: number,
      b: number,
    ) => Promise<{ rows: number[][]; finalUntil: number }>,
  ): Promise<number[][]> {
    const parts = monthParts(from, to);
    const files = parts.map((p) => path.join(dir, `${p.month}.json`));
    return locked(dir, async () => {
      const months = await Promise.all(files.map(readMonth));
      const missing = mergeRanges(
        parts.flatMap((p, i) => missingRanges(months[i], p.from, p.to)),
      );
      if (missing.length === 0) stats.cacheHits++;
      else if (opts.noDownload) noDownload(what);
      const fresh: number[][] = [];
      let finalUntil = Number.POSITIVE_INFINITY;
      for (const [a, b] of missing) {
        const got = await download(a, b);
        fresh.push(...got.rows);
        finalUntil = Math.min(finalUntil, got.finalUntil);
      }
      const out: number[][] = [];
      await Promise.all(
        parts.map(async (p, i) => {
          const have = months[i];
          const inPart = (r: number[]) =>
            timeOf(r) >= p.from && timeOf(r) < p.to;
          let file = have;
          const add = fresh.filter(inPart);
          const need = missingRanges(have, p.from, p.to);
          if (need.length) {
            const byTime = new Map<number, number[]>();
            for (const r of have?.rows ?? []) byTime.set(timeOf(r), r);
            for (const r of add) byTime.set(timeOf(r), r);
            const coverFrom = Math.min(have?.from ?? p.from, p.from);
            const coverTo = Math.max(
              have?.to ?? p.from,
              Math.min(p.to, finalUntil),
            );
            file = {
              from: coverFrom,
              to: Math.max(coverFrom, coverTo),
              rows: [...byTime.values()].sort((x, y) => timeOf(x) - timeOf(y)),
            };
            // Месяц целиком в будущем (данных ещё нет) — пустой файл не пишем.
            if (file.to > file.from || file.rows.length)
              await writeJson(files[i], file);
          }
          for (const r of file?.rows ?? []) if (inPart(r)) out.push(r);
        }),
      );
      return out.sort((x, y) => timeOf(x) - timeOf(y));
    });
  }

  return {
    stats,

    async symbols(market) {
      const file = path.join(opts.root, "symbols", `${market}.json`);
      if (opts.noDownload) {
        try {
          const cached = symbolsFileSchema.parse(
            JSON.parse(await readFile(file, "utf8")),
          );
          return { symbols: cached.symbols, snapshotAt: cached.at };
        } catch {
          return noDownload(`список символов ${market}`);
        }
      }
      const api = createMarketApi((url) =>
        request(
          limiters[market],
          url.includes("exchangeInfo") ? 1 : 80,
          url,
          `${market} символы`,
        ),
      );
      let list: MarketSymbol[];
      if (market === "spot") {
        list = (await api.fetch24hTickers("spot"))
          .filter((t) => t.quoteVolume > 0)
          .map((t) => ({ symbol: t.symbol }));
      } else {
        const perps = await api.fetchPerpetuals(market, { cryptoOnly: true });
        list = [...perps].flatMap(([symbol, size]) =>
          market === "coinm"
            ? size
              ? [{ symbol, contractSize: size }]
              : []
            : [{ symbol }],
        );
      }
      const symbols = list
        .filter((s) => isEligibleSymbol(s.symbol, market))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));
      const at = clock.now();
      await writeJson(file, { at, symbols });
      return { symbols, snapshotAt: at };
    },

    async klines(market, symbol, interval, from, to) {
      const ms = INTERVAL_MS[interval];
      const page = KLINES_PAGE[market];
      const rows = await ranged(
        path.join(opts.root, "klines", market, interval, symbol),
        `свечи ${market} ${symbol} ${interval}`,
        from,
        to,
        (r) => r[0],
        async (a, b) => {
          const fetchedAt = clock.now();
          const out: number[][] = [];
          for (let start = a; start < b; ) {
            const url = `${BASE[market]}/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&endTime=${b - 1}&limit=${page}`;
            const batch = parseKlines(
              await request(
                limiters[market],
                klinesWeight(market, page),
                url,
                `${market} ${symbol} ${interval}`,
              ),
              market,
            );
            out.push(
              ...batch
                .filter((c) => c.openTime >= start && c.openTime < b)
                .filter(closedBy(fetchedAt, ms))
                .map(toRow),
            );
            const last = batch.at(-1);
            if (!last || batch.length < page) break;
            start = last.openTime + ms;
          }
          // Окончательны свечи, закрытые к моменту загрузки: покрытие — до начала незакрытой.
          return { rows: out, finalUntil: Math.floor(fetchedAt / ms) * ms };
        },
      );
      return rows.map(fromRow);
    },

    async funding(market, symbol, from, to) {
      if (market === "spot") return [];
      const rows = await ranged(
        path.join(opts.root, "funding", market, symbol),
        `funding ${market} ${symbol}`,
        from,
        to,
        (r) => r[0],
        async (a, b) => {
          const fetchedAt = clock.now();
          const out: number[][] = [];
          for (let start = a; start < b; ) {
            const url = `${BASE[market]}/fundingRate?symbol=${symbol}&startTime=${start}&endTime=${b - 1}&limit=1000`;
            const batch = rawFundingSchema.parse(
              await request(
                fundingLimiter,
                1,
                url,
                `${market} ${symbol} funding`,
              ),
            );
            out.push(
              ...batch
                .filter((f) => f.fundingTime >= start && f.fundingTime < b)
                .map((f) => [f.fundingTime, f.fundingRate]),
            );
            const last = batch.at(-1);
            if (!last || batch.length < 1000) break;
            start = last.fundingTime + 1;
          }
          return { rows: out, finalUntil: fetchedAt };
        },
      );
      return rows.map((r) => ({ time: r[0], rate: r[1] }));
    },
  };
}
