import { MARKETS } from "@binance-dashboard/trading-core";
import { describe, expect, it } from "vitest";
import { ASSET_GROUPS, assetGroupOf } from "./assetGroup";

describe("ASSET_GROUPS", () => {
  it("каждому market движка соответствует группа с кодом из глоссария", () => {
    for (const m of MARKETS)
      expect(ASSET_GROUPS[m].code).toMatch(/^(SPOT|FT:USDM|FT:COINM)$/);
    expect(assetGroupOf("spot")).toMatchObject({ code: "SPOT", label: "Spot" });
    expect(assetGroupOf("futures")).toMatchObject({
      code: "FT:USDM",
      label: "USDⓈ-M",
    });
  });
});
