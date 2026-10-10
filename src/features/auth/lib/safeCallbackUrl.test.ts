import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./safeCallbackUrl";

describe("safeCallbackUrl", () => {
  it("оставляет внутренние пути", () => {
    expect(safeCallbackUrl("/signals?tab=1")).toBe("/signals?tab=1");
  });

  it("не пускает на чужие сайты и обратно на вход", () => {
    expect(safeCallbackUrl("https://evil.example")).toBe("/");
    expect(safeCallbackUrl("//evil.example")).toBe("/");
    expect(safeCallbackUrl("/login")).toBe("/");
    expect(safeCallbackUrl(undefined)).toBe("/");
  });
});
