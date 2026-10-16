import { describe, expect, it } from "vitest";
import { appVersionSchema, isStaleVersion } from "./appVersion";

describe("версия сборки", () => {
  it("клиент со старой сборкой — обе версии заданы и различаются", () => {
    expect(isStaleVersion("dpl_old", "dpl_new")).toBe(true);
  });

  it("та же версия — не старая сборка", () => {
    expect(isStaleVersion("dpl_new", "dpl_new")).toBe(false);
  });

  it("версия не задана хотя бы с одной стороны — не старая сборка", () => {
    expect(isStaleVersion(undefined, "dpl_new")).toBe(false);
    expect(isStaleVersion(null, "dpl_new")).toBe(false);
    expect(isStaleVersion("", "dpl_new")).toBe(false);
    expect(isStaleVersion("dpl_old", null)).toBe(false);
    expect(isStaleVersion(null, null)).toBe(false);
  });

  it("ответ /api/version — версия или null", () => {
    expect(appVersionSchema.parse({ version: "dpl_1" })).toEqual({
      version: "dpl_1",
    });
    expect(appVersionSchema.parse({ version: null })).toEqual({
      version: null,
    });
    expect(appVersionSchema.safeParse({}).success).toBe(false);
  });
});
