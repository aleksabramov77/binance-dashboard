// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defineSortTable,
  parseSort,
  readSortSnapshot,
  type SortTable,
  saveSort,
  subscribeSort,
} from "./sortStorage";

const KEYS = ["pnl", "trades"] as const;
const ITEMS = defineSortTable("page/[id]:items", KEYS);
const OTHER = defineSortTable("page:other", KEYS);
const ITEMS_KEY = "binance-dashboard:sort:page/[id]:items";

/** Чтение — как в useTableSort: снимок хранилища и его разбор. */
const loadSort = <K extends string>(table: SortTable<K>) =>
  parseSort(readSortSnapshot(table.name), table.keys);

describe("sortStorage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("имя таблицы «<маршрут>:<таблица>» → ключ binance-dashboard:sort:<маршрут>:<таблица>", () => {
    saveSort(ITEMS, { key: "pnl", dir: "desc" });
    expect(window.localStorage.getItem(ITEMS_KEY)).toBe(
      '{"key":"pnl","dir":"desc"}',
    );
    expect(loadSort(ITEMS)).toEqual({ key: "pnl", dir: "desc" });
  });

  it("сброс забывает сортировку", () => {
    saveSort(ITEMS, { key: "trades", dir: "asc" });
    saveSort(ITEMS, null);
    expect(window.localStorage.getItem(ITEMS_KEY)).toBeNull();
    expect(loadSort(ITEMS)).toBeNull();
  });

  it("у каждой таблицы своя сортировка", () => {
    saveSort(ITEMS, { key: "pnl", dir: "desc" });
    expect(loadSort(OTHER)).toBeNull();
    saveSort(OTHER, { key: "trades", dir: "asc" });
    expect(loadSort(ITEMS)).toEqual({ key: "pnl", dir: "desc" });
  });

  it("мусор в значении, неизвестная колонка или направление — нет сортировки", () => {
    for (const raw of [
      "{oops",
      "null",
      "[]",
      '"pnl"',
      '{"key":"gone","dir":"asc"}',
      '{"key":"pnl","dir":"up"}',
      '{"key":"pnl"}',
    ]) {
      window.localStorage.setItem(ITEMS_KEY, raw);
      expect(loadSort(ITEMS)).toBeNull();
    }
  });

  it("localStorage недоступен — сортировка живёт в памяти, ничего не падает", () => {
    const table = defineSortTable("page:blocked", KEYS);
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readSortSnapshot(table.name)).toBeNull();
    expect(() => saveSort(table, { key: "pnl", dir: "asc" })).not.toThrow();
    expect(loadSort(table)).toEqual({ key: "pnl", dir: "asc" });
    saveSort(table, null);
    expect(loadSort(table)).toBeNull();
  });

  it("запись не удалась (хранилище переполнено) — новая сортировка всё равно действует; потом снова пишется в localStorage", () => {
    const table = defineSortTable("page:full", KEYS);
    const key = "binance-dashboard:sort:page:full";
    saveSort(table, { key: "pnl", dir: "asc" });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    saveSort(table, { key: "trades", dir: "desc" });
    expect(loadSort(table)).toEqual({ key: "trades", dir: "desc" });

    setItem.mockRestore();
    saveSort(table, { key: "pnl", dir: "desc" });
    expect(window.localStorage.getItem(key)).toBe('{"key":"pnl","dir":"desc"}');
    window.localStorage.setItem(key, '{"key":"trades","dir":"asc"}');
    expect(loadSort(table)).toEqual({ key: "trades", dir: "asc" });
  });

  it("подписчики таблицы узнают об изменении сразу, подписчики другой таблицы — нет", () => {
    const onItems = vi.fn();
    const onOther = vi.fn();
    const unsubscribe = subscribeSort(ITEMS.name, onItems);
    subscribeSort(OTHER.name, onOther)();
    saveSort(ITEMS, { key: "pnl", dir: "desc" });
    expect(onItems).toHaveBeenCalledTimes(1);
    saveSort(OTHER, { key: "pnl", dir: "desc" });
    expect(onItems).toHaveBeenCalledTimes(1);
    unsubscribe();
    saveSort(ITEMS, null);
    expect(onItems).toHaveBeenCalledTimes(1);
    expect(onOther).not.toHaveBeenCalled();
  });

  it("изменение в другой вкладке (событие storage) доходит до подписчиков своей таблицы", () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeSort(ITEMS.name, onChange);
    window.dispatchEvent(new StorageEvent("storage", { key: ITEMS_KEY }));
    window.dispatchEvent(
      new StorageEvent("storage", { key: "binance-dashboard:sort:page:other" }),
    );
    // key: null — другая вкладка очистила хранилище целиком.
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
