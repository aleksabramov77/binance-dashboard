import { describe, expect, it } from "vitest";
import { type ExitPolicy, type OpenPosition, walkExits } from "./exits.ts";
import type { Candle } from "./types.ts";

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
  mae: 100,
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
      mae: 99,
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

describe("walkExits: MAE — худшая цена с входа (spec 0030)", () => {
  it("long — минимум low, short — максимум high по всем свечам", () => {
    const candles = [m(0, 100, 101, 99.2), m(1, 100, 101.8, 98.6)];
    expect(walkExits(long(), candles, policy()).mae).toBe(98.6);
    expect(walkExits(short(), candles, policy()).mae).toBe(101.8);
  });

  it("свеча выхода по тейку учтена своим low/high", () => {
    const r = walkExits(
      long(),
      [m(0, 100, 100.5, 99.5), m(1, 100, 104.5, 98.5)],
      policy(),
    );
    expect(r.exit?.reason).toBe("tp");
    expect(r.mae).toBe(98.5);
    const s = walkExits(
      short(),
      [m(0, 100, 100.5, 99.5), m(1, 100, 101.5, 95.5)],
      policy(),
    );
    expect(s.exit?.reason).toBe("tp");
    expect(s.mae).toBe(101.5);
  });

  it("стоп: MAE — цена срабатывания, а не хвост свечи после выхода; гэп — open", () => {
    expect(walkExits(long(), [m(0, 99, 99.5, 96)], policy()).mae).toBe(98);
    expect(walkExits(long(), [m(0, 97, 97.5, 96)], policy()).mae).toBe(97);
    expect(walkExits(short(), [m(0, 101, 103, 100.5)], policy()).mae).toBe(102);
  });

  it("тайм-стоп: MAE учитывает open свечи выхода", () => {
    const r = walkExits(
      long({ takeProfit: null, initialStop: null, stop: null }),
      [m(0, 100, 100.5, 99.8), m(60, 99, 99.5, 97)],
      policy({ timeStopBars: 1 }),
    );
    expect(r.exit?.reason).toBe("time");
    expect(r.mae).toBe(99);
  });

  it("MAE лучше входа не бывает: начальное значение — цена входа", () => {
    expect(walkExits(long(), [m(0, 101, 102, 100.5)], policy()).mae).toBe(100);
  });

  it("MAE не известна (сделка до spec 0030) — остаётся null", () => {
    expect(
      walkExits(long({ mae: null }), [m(0, 100, 101, 99)], policy()).mae,
    ).toBeNull();
    expect(
      walkExits(long({ mae: null }), [m(0, 99, 99.5, 96)], policy()).mae,
    ).toBeNull();
  });
});

describe("walkExits: трейлинг масштабируется с ценой (баг 0041)", () => {
  // Шорт по монете с ценой 1,00 и ATR 0,05 (5 % цены), трейлинг 2 ATR — дистанция 10 % от экстремума.
  const coin = (patch: Partial<OpenPosition> = {}): OpenPosition =>
    short({
      entryPrice: 1,
      initialStop: 1.1,
      stop: 1.1,
      takeProfit: null,
      atr: 0.05,
      extreme: 1,
      mae: 1,
      ...patch,
    });
  const trail = policy({ trailAtr: 2 });
  /** Обвал на 80 %: по 0,01 за минуту с 1,00 до 0,20, без откатов. */
  const crash = Array.from({ length: 80 }, (_, i) =>
    m(i, 1 - i * 0.01, 1 - i * 0.01, 1 - (i + 1) * 0.01),
  );

  it("«зомби»: после обвала и колебаний ±30 % от минимума позиция закрывается трейлингом", () => {
    // Колебания 0,20 ↔ 0,26 (+30 % от минимума) — неделя минутных свечей.
    const chop = Array.from({ length: 7 * 24 * 60 }, (_, i) =>
      m(80 + i, 0.2, 0.26, 0.2),
    );
    const r = walkExits(coin(), [...crash, ...chop], trail);
    expect(r.exit?.reason).toBe("trail");
    expect(r.exit?.at).toBe(80 * MIN);
    expect(r.exit?.price).toBeCloseTo(0.22, 10);
  });

  it("шорт после −80 %: стоп — минимум + 2 × 5 %, откат на 7,5 % не закрывает, на 12,5 % — закрывает", () => {
    const r = walkExits(coin(), crash, trail);
    expect(r.exit).toBeNull();
    expect(r.extreme).toBeCloseTo(0.2, 10);
    expect(r.stop).toBeCloseTo(0.22, 10);
    const next = { ...coin(), stop: r.stop, extreme: r.extreme, mae: r.mae };
    const at = r.checkedUntil;
    const from = { ...next, checkedUntil: at };
    expect(
      walkExits(from, [m(at / MIN, 0.2, 0.215, 0.2)], trail).exit,
    ).toBeNull();
    expect(
      walkExits(from, [m(at / MIN, 0.2, 0.225, 0.2)], trail).exit,
    ).toMatchObject({ reason: "trail" });
  });

  it("лонг после +100 %: дистанция вдвое больше в абсолюте (2 ATR входа × 2)", () => {
    const r = walkExits(
      long({ initialStop: null, stop: null, takeProfit: null }),
      [m(0, 100, 200, 100)],
      policy({ trailAtr: 2 }),
    );
    expect(r.stop).toBeCloseTo(196, 10);
  });

  it("при extreme = цена входа дистанция прежняя — trailAtr × ATR входа", () => {
    const flat = [m(0, 100, 100, 99.5)];
    expect(
      walkExits(
        long({ initialStop: null, stop: null, takeProfit: null }),
        flat,
        policy({ trailAtr: 2 }),
      ).stop,
    ).toBe(98);
    expect(
      walkExits(
        short({ initialStop: null, stop: null, takeProfit: null }),
        [m(0, 100, 100.5, 100)],
        policy({ trailAtr: 2 }),
      ).stop,
    ).toBe(102);
  });
});
