import { describe, expect, it } from "vitest";
import { atr, ema, rsi } from "./basic.ts";

describe("ema", () => {
  it("начинается с SMA и сходится к постоянному ряду", () => {
    const out = ema([1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4], 3);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(2);
    expect(out.at(-1)).toBeCloseTo(4, 2);
  });
});

describe("rsi", () => {
  it("100 при сплошном росте и ~0 при сплошном падении", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    expect(rsi(up)).toBe(100);
    expect(rsi([...up].reverse())).toBeLessThan(1);
  });

  it("около 50 при чередовании одинаковых шагов", () => {
    const zigzag = Array.from({ length: 60 }, (_, i) =>
      i % 2 === 0 ? 100 : 101,
    );
    expect(rsi(zigzag)).toBeGreaterThan(45);
    expect(rsi(zigzag)).toBeLessThan(55);
  });
});

describe("atr", () => {
  it("равен диапазону, когда все свечи одинаковые", () => {
    const candles = Array.from({ length: 20 }, () => ({
      high: 11,
      low: 9,
      close: 10,
    }));
    expect(atr(candles)).toBeCloseTo(2);
  });
});
