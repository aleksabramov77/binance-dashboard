import { describe, expect, it } from "vitest";
import {
  entryParams,
  positionSideOf,
  protectParams,
  reduceParams,
} from "./positionMode";

const oneway = { mode: "oneway", direction: "long" } as const;
const hedgeShort = { mode: "hedge", direction: "short" } as const;

describe("параметры ордеров по режиму позиций", () => {
  it("One-way: без positionSide, закрытие и защита — reduceOnly", () => {
    expect(positionSideOf(oneway)).toBe("BOTH");
    expect(entryParams(oneway)).toEqual({});
    expect(reduceParams(oneway)).toEqual({ reduceOnly: true });
    expect(protectParams(oneway, "40")).toEqual({
      quantity: "40",
      reduceOnly: true,
    });
  });
  it("Hedge: positionSide во всех ордерах, reduceOnly не передаётся", () => {
    expect(positionSideOf(hedgeShort)).toBe("SHORT");
    expect(entryParams(hedgeShort)).toEqual({ positionSide: "SHORT" });
    expect(reduceParams(hedgeShort)).toEqual({ positionSide: "SHORT" });
    expect(protectParams({ mode: "hedge", direction: "long" }, "0.5")).toEqual({
      quantity: "0.5",
      positionSide: "LONG",
    });
  });
  it("защита — никогда не closePosition", () => {
    for (const s of [oneway, hedgeShort])
      expect(protectParams(s, "1")).not.toHaveProperty("closePosition");
  });
});
