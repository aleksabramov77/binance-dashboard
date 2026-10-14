// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSortTable, type SavedSort, type SortTable } from "./sortStorage";
import { type SortHeadProps, useTableSort } from "./useTableSort";

// Настоящий путь данных: хук → хранилище → localStorage (happy-dom) → подписка → рендер, без заглушек.

const KEYS = ["pnl", "trades"] as const;
type Key = (typeof KEYS)[number];
const ITEMS = defineSortTable("page/[id]:items", KEYS);
const OTHER = defineSortTable("page/[id]:other", KEYS);
const BLOCKED = defineSortTable("page/[id]:blocked", KEYS);
const FALLBACK: SavedSort<Key> = { key: "trades", dir: "asc" };

/** Разметка таблицы: подпись различает экземпляры, кнопки — меню заголовка колонки. */
function View(props: {
  label: string;
  sort: SavedSort<Key> | null;
  head: (column: Key) => SortHeadProps;
}) {
  const pnl = props.head("pnl");
  return (
    <div>
      <output aria-label={props.label}>
        {props.sort ? `${props.sort.key} ${props.sort.dir}` : "по умолчанию"}
        {pnl.active ? " (PnL активна)" : ""}
      </output>
      <button type="button" onClick={() => pnl.onSort("desc")}>
        {props.label}: PnL ↓
      </button>
      <button type="button" onClick={() => props.head("trades").onSort("asc")}>
        {props.label}: Сделки ↑
      </button>
      <button type="button" onClick={pnl.onReset}>
        {props.label}: сбросить
      </button>
    </div>
  );
}

function Table(props: { label: string; table?: SortTable<Key> }) {
  const { sort, head } = useTableSort(props.table ?? ITEMS);
  return <View label={props.label} sort={sort} head={head} />;
}

function TableWithDefault(props: { label: string }) {
  const { sort, head } = useTableSort(ITEMS, FALLBACK);
  return <View label={props.label} sort={sort} head={head} />;
}

/** Страница: видима — открыта, скрыта — Next спрятал её в <Activity> после ухода через меню. */
function Page(props: { visible: boolean; label: string }) {
  return (
    <Activity mode={props.visible ? "visible" : "hidden"}>
      <Table label={props.label} />
    </Activity>
  );
}

const shown = (label: string) =>
  screen.getByRole("status", { name: label, hidden: true }).textContent;
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

describe("useTableSort — сортировка таблицы в localStorage", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("выбор сортировки пишется в localStorage под именем таблицы", () => {
    render(<Table label="A" />);
    expect(shown("A")).toBe("по умолчанию");
    click("A: PnL ↓");
    expect(shown("A")).toBe("pnl desc (PnL активна)");
    expect(
      window.localStorage.getItem("binance-dashboard:sort:page/[id]:items"),
    ).toBe('{"key":"pnl","dir":"desc"}');
  });

  it("показ → <Activity mode=hidden> → показ: таблица с сохранённой сортировкой", () => {
    const { rerender } = render(<Page visible label="A" />);
    click("A: PnL ↓");
    rerender(<Page visible={false} label="A" />);
    rerender(<Page visible label="A" />);
    expect(shown("A")).toBe("pnl desc (PnL активна)");
  });

  it("два экземпляра одной таблицы видят изменение сразу, в том числе скрытый в <Activity>", () => {
    function TwoPages(props: { secondVisible: boolean }) {
      return (
        <>
          <Page visible label="A" />
          <Page visible={props.secondVisible} label="B" />
        </>
      );
    }
    const { rerender } = render(<TwoPages secondVisible />);
    click("A: PnL ↓");
    expect(shown("B")).toBe("pnl desc (PnL активна)");

    // B спрятан (ушли на другую страницу маршрута), сортировку меняют на A, затем возвращаются к B.
    rerender(<TwoPages secondVisible={false} />);
    click("A: Сделки ↑");
    rerender(<TwoPages secondVisible />);
    expect(shown("B")).toBe("trades asc");

    click("B: сбросить");
    expect(shown("A")).toBe("по умолчанию");
  });

  it("F5 и новая вкладка: заново открытая таблица читает сохранённую сортировку", () => {
    render(<Table label="A" />);
    click("A: Сделки ↑");
    cleanup();
    render(<Table label="A" />);
    expect(shown("A")).toBe("trades asc");
  });

  it("ничего не сохранено — порядок по умолчанию; сброс возвращает его", () => {
    render(<TableWithDefault label="A" />);
    expect(shown("A")).toBe("trades asc");
    click("A: PnL ↓");
    expect(shown("A")).toBe("pnl desc (PnL активна)");
    click("A: сбросить");
    expect(shown("A")).toBe("trades asc");
    expect(
      window.localStorage.getItem("binance-dashboard:sort:page/[id]:items"),
    ).toBeNull();
  });

  it("таблицы с разными именами независимы", () => {
    render(
      <>
        <Table label="A" />
        <Table label="B" table={OTHER} />
      </>,
    );
    click("A: PnL ↓");
    expect(shown("B")).toBe("по умолчанию");
  });

  it("StrictMode: подписка снимается и ставится заново без потери сортировки", () => {
    render(
      <StrictMode>
        <Page visible label="A" />
        <Page visible label="B" />
      </StrictMode>,
    );
    click("A: PnL ↓");
    expect(shown("B")).toBe("pnl desc (PnL активна)");
  });

  it("localStorage недоступен — сортировка работает в памяти, страница не падает", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <>
        <Table label="A" table={BLOCKED} />
        <Table label="B" table={BLOCKED} />
      </>,
    );
    click("A: PnL ↓");
    expect(shown("A")).toBe("pnl desc (PnL активна)");
    expect(shown("B")).toBe("pnl desc (PnL активна)");
  });
});
