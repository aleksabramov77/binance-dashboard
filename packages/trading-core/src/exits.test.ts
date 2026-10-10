import { describe, expect, it } from "vitest";
import { type ExitPolicy, type OpenPosition, walkExits } from "./exits";
import type { Candle } from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const m = (
  minute: number,
  open: number,
  high: number,
  low: number,
  close = open,
): Candle => ({ openTime: minute * MIN, open, high, low, close, volume: 1 });

const long = (patch: Partial<OpenPosition> = {}): OpenPosition => ({
  direction: "long",
  entryPrice: 100,
  initialStop: 98,
  stop: 98,
  takeProfit: 104,
  atr: 1,
  extreme: 100,
  openedAt: 0,
  checkedUntil: 0,
  ...patch,
});
const short = (patch: Partial<OpenPosition> = {}): OpenPosition =>
  long({
    direction: "short",
    initialStop: 102,
    stop: 102,
    takeProfit: 96,
    ...patch,
  });
const policy = (patch: Partial<ExitPolicy> = {}): ExitPolicy => ({
  timeframeMs: HOUR,
  ...patch,
});

describe("walkExits: стоп и тейк", () => {
  it("цена внутри уровней — выхода нет, экстремум и checkedUntil обновлены", () => {
    const r = walkExits(
      long(),
      [m(0, 100, 101, 99), m(1, 100, 101.5, 99.5)],
      policy(),
    );
    expect(r).toEqual({
      exit: null,
      stop: 98,
      extreme: 101.5,
      checkedUntil: 2 * MIN,
    });
  });

  it("long: стоп и тейк по уровням", () => {
    expect(walkExits(long(), [m(0, 99, 100, 97.5)], policy()).exit).toEqual({
      reason: "sl",
      price: 98,
      at: 0,
    });
    expect(walkExits(long(), [m(3, 103, 104.5, 102)], policy()).exit).toEqual({
      reason: "tp",
      price: 104,
      at: 3 * MIN,
    });
  });

  it("стоп и тейк в одной свече — засчитывается стоп", () => {
    expect(walkExits(long(), [m(0, 100, 105, 97)], policy()).exit?.reason).toBe(
      "sl",
    );
  });

  it("гэп через уровень — исполнение по open", () => {
    expect(walkExits(long(), [m(0, 96, 96.5, 95)], policy()).exit?.price).toBe(
      96,
    );
    expect(
      walkExits(long(), [m(0, 106, 107, 105.5)], policy()).exit?.price,
    ).toBe(106);
  });

  it("свечи до checkedUntil не проверяются повторно", () => {
    const r = walkExits(
      long({ checkedUntil: 2 * MIN }),
      [m(1, 90, 91, 89), m(2, 100, 101, 99)],
      policy(),
    );
    expect(r.exit).toBeNull();
    expect(r.checkedUntil).toBe(3 * MIN);
  });

  it("short: стоп выше, тейк ниже", () => {
    expect(
      walkExits(short(), [m(0, 101, 102.5, 100.5)], policy()).exit,
    ).toMatchObject({ reason: "sl", price: 102 });
    expect(
      walkExits(short(), [m(0, 97, 97.5, 95.5)], policy()).exit,
    ).toMatchObject({ reason: "tp", price: 96 });
  });
});

describe("walkExits: безубыток и трейлинг", () => {
  it("после +1R стоп переносится на вход со следующей свечи", () => {
    const candles = [m(0, 100, 102.2, 99.5), m(1, 101, 101.5, 99.9)];
    const r = walkExits(long(), candles, policy({ breakevenAtR: 1 }));
    expect(r.exit).toEqual({ reason: "breakeven", price: 100, at: MIN });
  });

  it("трейлинг подтягивает стоп за экстремумом и не ослабляет его", () => {
    const pos = long({ takeProfit: null });
    const p = policy({ trailAtr: 2 });
    const r = walkExits(
      pos,
      [m(0, 100, 103, 100), m(1, 103, 105, 103), m(2, 104.5, 104, 103.5)],
      p,
    );
    expect(r.exit).toBeNull();
    expect(r.stop).toBe(103);
    const out = walkExits(
      {
        ...pos,
        stop: r.stop,
        extreme: r.extreme,
        checkedUntil: r.checkedUntil,
      },
      [m(3, 103.5, 104, 102.5)],
      p,
    );
    expect(out.exit).toEqual({ reason: "trail", price: 103, at: 3 * MIN });
  });

  it("short: трейлинг вниз", () => {
    const r = walkExits(
      short({ takeProfit: null }),
      [m(0, 100, 100, 97)],
      policy({ trailAtr: 2 }),
    );
    expect(r.stop).toBe(99);
  });

  it("без стопа трейлинг создаёт стоп", () => {
    const r = walkExits(
      long({ initialStop: null, stop: null, takeProfit: null }),
      [m(0, 100, 110, 100)],
      policy({ trailAtr: 3 }),
    );
    expect(r.stop).toBe(107);
  });
});

describe("walkExits: тайм-стоп", () => {
  it("через N свечей таймфрейма выход по open", () => {
    const pos = long({ takeProfit: null, checkedUntil: 119 * MIN });
    const r = walkExits(
      pos,
      [m(119, 100, 101, 99), m(120, 100.5, 101, 100)],
      policy({ timeStopBars: 2 }),
    );
    expect(r.exit).toEqual({ reason: "time", price: 100.5, at: 2 * HOUR });
  });
});
