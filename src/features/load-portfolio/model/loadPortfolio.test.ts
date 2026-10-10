import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPortfolio } from "./loadPortfolio";

describe("loadPortfolio без ключа", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("локально — инструкция по подключению ключа", async () => {
    vi.stubEnv("BINANCE_API_KEY", "");
    vi.stubEnv("VERCEL", "");
    expect(await loadPortfolio()).toEqual({
      status: "not-configured",
      hosting: "local",
    });
  });

  it("в облаке (VERCEL=1) — портфель только на компьютере", async () => {
    vi.stubEnv("BINANCE_API_KEY", "");
    vi.stubEnv("VERCEL", "1");
    expect(await loadPortfolio()).toEqual({
      status: "not-configured",
      hosting: "cloud",
    });
  });
});
