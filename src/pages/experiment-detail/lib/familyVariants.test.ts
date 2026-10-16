import { describe, expect, it } from "vitest";
import { enabledFamilyVariants } from "./familyVariants";

const family = {
  control: { id: "S90" },
  variants: [
    { id: "S91", enabled: true },
    { id: "S92", enabled: false },
    { id: "S93", enabled: true },
  ],
};

describe("enabledFamilyVariants", () => {
  it("у контрольного — только включённые варианты", () => {
    expect(enabledFamilyVariants("S90", family)).toEqual(["S91", "S93"]);
  });

  it("у варианта — пусто: его выключение не трогает контрольный", () => {
    expect(enabledFamilyVariants("S91", family)).toEqual([]);
  });

  it("эксперимент без группы — пусто", () => {
    expect(enabledFamilyVariants("S90", null)).toEqual([]);
  });
});
