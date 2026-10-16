import { describe, expect, it } from "vitest";
import { variantsToConfirm } from "./variantsToConfirm";

describe("variantsToConfirm", () => {
  it("берёт варианты, известные странице", () => {
    expect(variantsToConfirm(["S99"], [])).toEqual(["S99"]);
  });

  it("страница не знала о вариантах — берёт список из ответа 409", () => {
    expect(variantsToConfirm([], ["S98", "S99"])).toEqual(["S98", "S99"]);
  });

  it("нет ни тех, ни других — предупреждения нет", () => {
    expect(variantsToConfirm([], [])).toEqual([]);
  });
});
