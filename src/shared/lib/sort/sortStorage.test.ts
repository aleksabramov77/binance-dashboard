import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSort, saveSort } from "./sortStorage";

const KEYS = ["pnl", "trades"] as const;

describe("sortStorage", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("сохраняет и читает сортировку таблицы", () => {
    saveSort("t", { key: "pnl", dir: "desc" });
    expect(loadSort("t", KEYS)).toEqual({ key: "pnl", dir: "desc" });
    expect(loadSort("other", KEYS)).toBeNull();
  });

  it("сброс забывает сортировку", () => {
    saveSort("t", { key: "pnl", dir: "desc" });
    saveSort("t", null);
    expect(loadSort("t", KEYS)).toBeNull();
  });

  it("неизвестная колонка или мусор — null", () => {
    saveSort("t", { key: "gone", dir: "asc" });
    expect(loadSort("t", KEYS)).toBeNull();
    store.set("binance-dashboard:sort:t", "{oops");
    expect(loadSort("t", KEYS)).toBeNull();
  });

  it("недоступное хранилище не роняет страницу", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("blocked");
      },
    });
    expect(() => saveSort("t", { key: "pnl", dir: "asc" })).not.toThrow();
    expect(loadSort("t", KEYS)).toBeNull();
  });
});
