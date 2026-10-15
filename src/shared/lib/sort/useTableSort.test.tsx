// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Activity, type ReactNode, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSortTable, type SavedSort, type SortTable } from "./sortStorage";
import { type SortHeadProps, useTableSort } from "./useTableSort";

// Настоящий путь данных: хук → хранилище → localStorage (happy-dom) → подписка → рендер, без заглушек.

const KEYS = ["pnl", "trades"] as const;
type Key = (typeof KEYS)[number];
const ITEMS = defineSortTable("page/[id]:items", KEYS);
const ITEMS_KEY = "binance-dashboard:sort:page/[id]:items";
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

/**
 * Страница в <Activity>, как сегмент Next: видима — открыта, скрыта — ушли через меню. Элемент таблицы
 * создают один раз и передают детьми: при показе React не перерисовывает его вместе с родителем, и
 * свежую сортировку даёт только сверка снимка хранилища при повторном подключении эффектов.
 */
function Page(props: { visible: boolean; children: ReactNode }) {
  return (
    <Activity mode={props.visible ? "visible" : "hidden"}>
      {props.children}
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
    expect(window.localStorage.getItem(ITEMS_KEY)).toBe(
      '{"key":"pnl","dir":"desc"}',
    );
  });

  it("показ → <Activity mode=hidden> → показ: сортировка на месте, изменённая за это время в другой вкладке — подхватывается", () => {
    const a = <Table label="A" />;
    const { rerender } = render(<Page visible>{a}</Page>);
    click("A: PnL ↓");
    rerender(<Page visible={false}>{a}</Page>);
    rerender(<Page visible>{a}</Page>);
    expect(shown("A")).toBe("pnl desc (PnL активна)");

    // Пока страница скрыта, сортировку этой таблицы поменяли в другой вкладке.
    rerender(<Page visible={false}>{a}</Page>);
    act(() => {
      window.localStorage.setItem(ITEMS_KEY, '{"key":"trades","dir":"asc"}');
      window.dispatchEvent(new StorageEvent("storage", { key: ITEMS_KEY }));
    });
    rerender(<Page visible>{a}</Page>);
    expect(shown("A")).toBe("trades asc");
  });

  it("два экземпляра одной таблицы видят изменение сразу, в том числе скрытый в <Activity>", () => {
    const a = <Table label="A" />;
    const b = <Table label="B" />;
    const pages = (secondVisible: boolean) => (
      <>
        <Page visible>{a}</Page>
        <Page visible={secondVisible}>{b}</Page>
      </>
    );
    const { rerender } = render(pages(true));
    click("A: PnL ↓");
    expect(shown("B")).toBe("pnl desc (PnL активна)");

    // B спрятан (ушли на другую страницу маршрута), сортировку меняют на A, затем возвращаются к B.
    rerender(pages(false));
    click("A: Сделки ↑");
    rerender(pages(true));
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
    expect(window.localStorage.getItem(ITEMS_KEY)).toBeNull();
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
        <Page visible>
          <Table label="A" />
        </Page>
        <Page visible>
          <Table label="B" />
        </Page>
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
