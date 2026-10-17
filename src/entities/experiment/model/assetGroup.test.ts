import { MARKETS } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import {
  ASSET_GROUPS,
  assetGroupOf,
  DEMO_MIRROR_MARKETS,
  LIVE_MIRROR_MARKETS,
  parseMarketParam,
} from "./assetGroup";

describe("ASSET_GROUPS", () => {
  it("каждому market движка соответствует группа с кодом из глоссария", () => {
    for (const m of MARKETS)
      expect(ASSET_GROUPS[m].code).toMatch(/^(SPOT|FT:USDM|FT:COINM)$/);
    expect(assetGroupOf("spot")).toMatchObject({ code: "SPOT", label: "Spot" });
    expect(assetGroupOf("usdm")).toMatchObject({
      code: "FT:USDM",
      label: "USDⓈ-M",
    });
    expect(assetGroupOf("coinm")).toMatchObject({
      code: "FT:COINM",
      label: "COIN-M",
    });
  });

  it("порядок групп — Spot, USDⓈ-M, COIN-M; фьючерсы — обе группы M", () => {
    expect(Object.keys(ASSET_GROUPS)).toEqual(["spot", "usdm", "coinm"]);
    expect(MARKETS.map((m) => ASSET_GROUPS[m].kind)).toEqual([
      "spot",
      "futures",
      "futures",
    ]);
  });

  it("демо-зеркало доступно у всех групп, COIN-M — на demo-dapi (spec 0056)", () => {
    for (const m of MARKETS)
      expect(ASSET_GROUPS[m].demoMirrorBlocked).toBeNull();
    expect([...DEMO_MIRROR_MARKETS]).toEqual(
      MARKETS.filter((m) => ASSET_GROUPS[m].demoMirrorBlocked === null),
    );
    expect([...DEMO_MIRROR_MARKETS]).toEqual(["spot", "usdm", "coinm"]);
  });

  it("реальный счёт — свой список без COIN-M, не общий с демо (spec 0056, AC9)", () => {
    expect([...LIVE_MIRROR_MARKETS]).toEqual(["spot", "usdm"]);
  });

  it("фильтр из URL: старое futures — USDⓈ-M, мусор — null", () => {
    expect(parseMarketParam("futures")).toBe("usdm");
    expect(parseMarketParam("coinm")).toBe("coinm");
    expect(parseMarketParam("spot")).toBe("spot");
    expect(parseMarketParam("all")).toBeNull();
    expect(parseMarketParam("xyz")).toBeNull();
  });
});
