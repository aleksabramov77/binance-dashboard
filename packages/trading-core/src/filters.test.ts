import { describe, expect, it } from "vitest";
import { type MarketFilter, marketFilterSchema } from "./experiment.ts";
import { marketRegimeAllows, sessionAllows } from "./filters.ts";
import type { Candle } from "./types.ts";

const H4 = 4 * 60 * 60_000;

/** Свечи с close из списка; high/low — ±1 от close. */
const series = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    openTime: i * H4,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 1,
  }));

const rising = series(Array.from({ length: 60 }, (_, i) => 100 + i));
const falling = series(Array.from({ length: 60 }, (_, i) => 200 - i));

const filter = (patch: Partial<MarketFilter> = {}): MarketFilter =>
  marketFilterSchema.parse({
    timeframe: "4h",
    ema: 20,
    long: "above",
    short: "below",
    ...patch,
  });

describe("marketRegimeAllows", () => {
  it("long — только выше EMA, short — только ниже", () => {
    expect(marketRegimeAllows(rising, filter(), "long")).toBe(true);
    expect(marketRegimeAllows(rising, filter(), "short")).toBe(false);
    expect(marketRegimeAllows(falling, filter(), "long")).toBe(false);
    expect(marketRegimeAllows(falling, filter(), "short")).toBe(true);
  });

  it("any — направление не зависит от EMA; условие можно перевернуть", () => {
    const f = filter({ long: "any", short: "above" });
    expect(marketRegimeAllows(falling, f, "long")).toBe(true);
    expect(marketRegimeAllows(rising, f, "short")).toBe(true);
    expect(marketRegimeAllows(falling, f, "short")).toBe(false);
  });

  it("решает по последней переданной (закрытой) свече: будущих свечей не видит", () => {
    // Рост, затем обвал на последней свече: по ней цена уже ниже EMA.
    const crash = series([...rising.map((c) => c.close), 50]);
    expect(marketRegimeAllows(crash, filter(), "long")).toBe(false);
    // Та же история без последней свечи (она ещё не закрыта) — режим прежний.
    expect(marketRegimeAllows(crash.slice(0, -1), filter(), "long")).toBe(true);
  });

  it("нет свечей или их меньше периода EMA — вход запрещён", () => {
    expect(marketRegimeAllows([], filter(), "long")).toBe(false);
    expect(marketRegimeAllows([], filter({ long: "any" }), "long")).toBe(false);
    expect(marketRegimeAllows(rising.slice(0, 10), filter(), "long")).toBe(
      false,
    );
  });

  it("minAdx: слабый тренд (флэт) не пропускает, сильный — пропускает", () => {
    const flat = series(
      Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 0.5 : -0.5)),
    );
    const f = filter({ long: "any", short: "any", minAdx: 25 });
    expect(marketRegimeAllows(flat, f, "long")).toBe(false);
    expect(marketRegimeAllows(rising, f, "long")).toBe(true);
    expect(marketRegimeAllows(rising.slice(0, 20), f, "long")).toBe(false);
  });

  it("symbol по умолчанию — BTCUSDT", () => {
    expect(filter().symbol).toBe("BTCUSDT");
  });
});

describe("sessionAllows", () => {
  // 2026-10-10 — суббота (6), 2026-10-11 — воскресенье (0).
  const at = (iso: string) => Date.parse(iso);

  it("окно часов [from, to): from входит, to — нет", () => {
    const f = { hoursUtc: [8, 16] as [number, number] };
    expect(sessionAllows(at("2026-10-10T08:00:00Z"), f)).toBe(true);
    expect(sessionAllows(at("2026-10-10T15:59:00Z"), f)).toBe(true);
    expect(sessionAllows(at("2026-10-10T16:00:00Z"), f)).toBe(false);
    expect(sessionAllows(at("2026-10-10T07:59:00Z"), f)).toBe(false);
  });

  it("окно через полночь: [22, 6)", () => {
    const f = { hoursUtc: [22, 6] as [number, number] };
    expect(sessionAllows(at("2026-10-10T23:30:00Z"), f)).toBe(true);
    expect(sessionAllows(at("2026-10-11T00:00:00Z"), f)).toBe(true);
    expect(sessionAllows(at("2026-10-11T05:59:00Z"), f)).toBe(true);
    expect(sessionAllows(at("2026-10-11T06:00:00Z"), f)).toBe(false);
    expect(sessionAllows(at("2026-10-10T12:00:00Z"), f)).toBe(false);
  });

  it("дни недели по UTC; вместе с часами — оба условия", () => {
    const weekdays = { days: [1, 2, 3, 4, 5] };
    expect(sessionAllows(at("2026-10-10T12:00:00Z"), weekdays)).toBe(false);
    expect(sessionAllows(at("2026-10-12T12:00:00Z"), weekdays)).toBe(true);
    const both = { days: [0], hoursUtc: [0, 12] as [number, number] };
    expect(sessionAllows(at("2026-10-11T03:00:00Z"), both)).toBe(true);
    expect(sessionAllows(at("2026-10-11T13:00:00Z"), both)).toBe(false);
    expect(sessionAllows(at("2026-10-10T03:00:00Z"), both)).toBe(false);
  });

  it("[0, 24) — весь день", () => {
    expect(
      sessionAllows(at("2026-10-10T23:59:00Z"), { hoursUtc: [0, 24] }),
    ).toBe(true);
  });
});
