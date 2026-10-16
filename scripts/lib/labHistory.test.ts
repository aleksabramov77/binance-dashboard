import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Clock,
  createDiskHistory,
  createTransport,
  createWeightLimiter,
  type HttpResponse,
  klinesWeight,
  mergeRanges,
  missingRanges,
  monthParts,
  NotCachedError,
  RateLimitStopError,
} from "./labHistory";

const MIN = 60_000;
const HOUR = 60 * MIN;
const OCT = Date.parse("2026-10-01T00:00:00Z");

/** Часы без ожидания: sleep двигает время вперёд. */
function fakeClock(start = OCT): Clock & { slept: number[] } {
  let now = start;
  const slept: number[] = [];
  return {
    slept,
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
  };
}

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): HttpResponse => ({
  status,
  headers: { get: (name) => headers[name.toLowerCase()] ?? null },
  json: async () => body,
});

describe("месяцы и покрытие кэша", () => {
  it("делит диапазон по UTC-месяцам", () => {
    const parts = monthParts(
      Date.parse("2026-09-20T00:00:00Z"),
      Date.parse("2026-11-02T00:00:00Z"),
    );
    expect(parts.map((p) => p.month)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    expect(parts[1]).toMatchObject({
      from: OCT,
      to: Date.parse("2026-11-01T00:00:00Z"),
    });
  });

  it("недостающее — куски до и после покрытия, покрытие остаётся непрерывным", () => {
    expect(missingRanges(null, 0, 10)).toEqual([[0, 10]]);
    expect(missingRanges({ from: 3, to: 6 }, 4, 5)).toEqual([]);
    expect(missingRanges({ from: 3, to: 6 }, 0, 10)).toEqual([
      [0, 3],
      [6, 10],
    ]);
    // Запрос после покрытия с разрывом — догружается и разрыв.
    expect(missingRanges({ from: 3, to: 6 }, 8, 10)).toEqual([[6, 10]]);
  });

  it("склеивает соседние куски в одну серию запросов", () => {
    expect(
      mergeRanges([
        [10, 20],
        [0, 10],
        [30, 40],
      ]),
    ).toEqual([
      [0, 20],
      [30, 40],
    ]);
  });
});

describe("лимитер веса", () => {
  it("ждёт, пока окно освободится", async () => {
    const clock = fakeClock();
    const limiter = createWeightLimiter(10, 60_000, clock);
    await limiter.acquire(6);
    await limiter.acquire(4);
    expect(clock.slept).toEqual([]);
    await limiter.acquire(1);
    expect(clock.slept.reduce((s, x) => s + x, 0)).toBeGreaterThanOrEqual(
      60_000,
    );
  });

  it("веса свечей Binance: spot — 2, фьючерсы — по limit", () => {
    expect(klinesWeight("spot", 1000)).toBe(2);
    expect(klinesWeight("usdm", 499)).toBe(2);
    expect(klinesWeight("usdm", 500)).toBe(5);
    expect(klinesWeight("coinm", 1500)).toBe(10);
  });
});

describe("транспорт: 429/418 и повторы", () => {
  it("на 429 ждёт Retry-After и повторяет", async () => {
    const clock = fakeClock();
    const answers = [json(429, {}, { "retry-after": "7" }), json(200, [1])];
    const get = createTransport({
      fetch: async () => answers.shift() ?? json(500, null),
      clock,
    });
    expect(await get("https://fapi.binance.com/fapi/v1/x")).toEqual([1]);
    expect(clock.slept).toEqual([7000]);
  });

  it("бан 418 дольше 10 минут — останов липкий: следующие запросы к хосту без сети", async () => {
    const clock = fakeClock();
    let calls = 0;
    const get = createTransport({
      fetch: async () => {
        calls++;
        return json(418, { msg: `IP banned until ${OCT + 3 * HOUR}` });
      },
      clock,
    });
    expect(get.stopped()).toBeNull();
    await expect(get("https://api.binance.com/api/v3/x")).rejects.toThrow(
      /418/,
    );
    await expect(
      get("https://api.binance.com/api/v3/y"),
    ).rejects.toBeInstanceOf(RateLimitStopError);
    expect(calls).toBe(1);
    expect(get.stopped()).toBeInstanceOf(RateLimitStopError);
  });

  it("429 после всех пауз — тоже липкий останов", async () => {
    const clock = fakeClock();
    let calls = 0;
    const get = createTransport({
      fetch: async () => {
        calls++;
        return json(429, {}, { "retry-after": "5" });
      },
      clock,
    });
    await expect(get("https://fapi.binance.com/fapi/v1/a")).rejects.toThrow(
      /429/,
    );
    const before = calls;
    await expect(
      get("https://fapi.binance.com/fapi/v1/b"),
    ).rejects.toBeInstanceOf(RateLimitStopError);
    expect(calls).toBe(before);
  });

  it("сетевой сбой повторяет, 4xx — нет", async () => {
    const clock = fakeClock();
    let calls = 0;
    const flaky = createTransport({
      fetch: async () => {
        calls++;
        if (calls === 1) throw new Error("socket hang up");
        return json(200, "ok");
      },
      clock,
    });
    expect(await flaky("https://api.binance.com/a")).toBe("ok");
    const bad = createTransport({
      fetch: async () => json(400, { code: -1121 }),
      clock,
    });
    await expect(bad("https://api.binance.com/b")).rejects.toThrow(/400/);
  });
});

describe("дисковый кэш истории", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /** Binance-подобные свечи 1h: до limit от startTime, не дальше now (последняя — незакрытая). */
  function fakeBinance(clock: Clock) {
    const urls: URL[] = [];
    const fetch = async (raw: string) => {
      const url = new URL(raw);
      urls.push(url);
      const start = Number(url.searchParams.get("startTime"));
      const endTime = Number(url.searchParams.get("endTime"));
      const limit = Number(url.searchParams.get("limit"));
      const rows: unknown[] = [];
      for (
        let t = Math.ceil(start / HOUR) * HOUR;
        t <= Math.min(endTime, clock.now()) && rows.length < limit;
        t += HOUR
      )
        rows.push([t, "1", "2", "0.5", "1.5", "10", t + HOUR - 1, "15"]);
      return json(200, rows);
    };
    return { urls, fetch };
  }

  const tmp = () => {
    const d = mkdtempSync(path.join(os.tmpdir(), "lab-history-"));
    dirs.push(d);
    return d;
  };

  it("второй запрос того же периода не ходит в сеть, расширение — только недостающее", async () => {
    const root = tmp();
    const clock = fakeClock(Date.parse("2026-10-20T00:30:00Z"));
    const binance = fakeBinance(clock);
    const history = createDiskHistory({ root, fetch: binance.fetch, clock });
    const from = Date.parse("2026-09-29T00:00:00Z");
    const to = Date.parse("2026-10-03T00:00:00Z");
    const first = await history.klines("usdm", "AAAUSDT", "1h", from, to);
    expect(first).toHaveLength(96);
    expect(first[0]).toMatchObject({ openTime: from, quoteVolume: 15 });
    const requests = history.stats.requests;
    expect(requests).toBeGreaterThan(0);

    const again = createDiskHistory({ root, fetch: binance.fetch, clock });
    expect(await again.klines("usdm", "AAAUSDT", "1h", from, to)).toEqual(
      first,
    );
    expect(again.stats.requests).toBe(0);

    binance.urls.length = 0;
    const more = await again.klines(
      "usdm",
      "AAAUSDT",
      "1h",
      from,
      Date.parse("2026-10-04T00:00:00Z"),
    );
    expect(more).toHaveLength(120);
    expect(
      binance.urls.map((u) => Number(u.searchParams.get("startTime"))),
    ).toEqual([to]);
  });

  it("незакрытая на момент загрузки свеча в кэш не попадает и догружается потом", async () => {
    const root = tmp();
    const clock = fakeClock(Date.parse("2026-10-02T05:30:00Z"));
    const binance = fakeBinance(clock);
    const history = createDiskHistory({ root, fetch: binance.fetch, clock });
    const from = Date.parse("2026-10-02T00:00:00Z");
    const to = Date.parse("2026-10-02T12:00:00Z");
    const early = await history.klines("spot", "AAAUSDT", "1h", from, to);
    // 00:00–04:00 закрыты, 05:00 — незакрыта.
    expect(early.map((c) => new Date(c.openTime).getUTCHours())).toEqual([
      0, 1, 2, 3, 4,
    ]);
    await clock.sleep(10 * HOUR);
    const later = await history.klines("spot", "AAAUSDT", "1h", from, to);
    expect(later).toHaveLength(12);
  });

  it("--no-download: нет в кэше — понятная ошибка, сеть не трогается", async () => {
    const history = createDiskHistory({
      root: tmp(),
      noDownload: true,
      fetch: async () => {
        throw new Error("сеть недоступна в тесте");
      },
      clock: fakeClock(),
    });
    await expect(
      history.klines("usdm", "AAAUSDT", "1h", OCT, OCT + HOUR),
    ).rejects.toBeInstanceOf(NotCachedError);
    await expect(history.symbols("usdm")).rejects.toBeInstanceOf(
      NotCachedError,
    );
  });
});
