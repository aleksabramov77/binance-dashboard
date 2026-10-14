// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { Activity, StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SavedSort, saveSort, useRestoreSort } from "./sortStorage";

// С cacheComponents Next 16 не размонтирует страницу при уходе, а прячет её в <Activity mode="hidden">
// (spec 009). Эффекты при повторном показе запускаются заново, useRef сохраняет значение.

const KEYS = ["pnl", "trades"] as const;
type Key = (typeof KEYS)[number];
const SAVED: SavedSort<Key> = { key: "pnl", dir: "desc" };

function Table(props: {
  inUrl: boolean;
  apply: (saved: SavedSort<Key>) => void;
}) {
  useRestoreSort("t", KEYS, props.inUrl, props.apply);
  return null;
}

/** Страница с таблицей: видима — открыта, скрыта — пользователь ушёл через меню. */
function Page(props: {
  visible: boolean;
  inUrl: boolean;
  apply: (saved: SavedSort<Key>) => void;
}) {
  return (
    <Activity mode={props.visible ? "visible" : "hidden"}>
      <Table inUrl={props.inUrl} apply={props.apply} />
    </Activity>
  );
}

describe("useRestoreSort при уходе со страницы и возврате (<Activity>)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(cleanup);

  it("применяет сохранённую сортировку при каждом показе таблицы, а не только при первом монтировании", () => {
    saveSort("t", SAVED);
    const apply = vi.fn();
    const { rerender } = render(<Page visible inUrl={false} apply={apply} />);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(SAVED);

    // Сортировка попала в URL; ушли через меню; вернулись через меню — в URL её нет.
    rerender(<Page visible inUrl apply={apply} />);
    rerender(<Page visible={false} inUrl apply={apply} />);
    rerender(<Page visible inUrl={false} apply={apply} />);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(SAVED);
  });

  it("сортировка в URL главнее: сохранённая не применяется ни при первом показе, ни при повторном", () => {
    saveSort("t", SAVED);
    const apply = vi.fn();
    const { rerender } = render(<Page visible inUrl apply={apply} />);
    rerender(<Page visible={false} inUrl apply={apply} />);
    rerender(<Page visible inUrl apply={apply} />);
    expect(apply).not.toHaveBeenCalled();
  });

  it("после «Сбросить сортировку» возврат на страницу не возвращает старую сортировку", () => {
    saveSort("t", SAVED);
    const apply = vi.fn();
    const { rerender } = render(<Page visible inUrl={false} apply={apply} />);
    rerender(<Page visible inUrl apply={apply} />);
    // Сброс: сортировка уходит из URL, сохранённая забывается.
    saveSort("t", null);
    rerender(<Page visible inUrl={false} apply={apply} />);
    rerender(<Page visible={false} inUrl={false} apply={apply} />);
    rerender(<Page visible inUrl={false} apply={apply} />);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("StrictMode (эффект: запуск → очистка → запуск): повторное применение безвредно", () => {
    saveSort("t", SAVED);
    const apply = vi.fn();
    // «URL» живёт вне страницы, как настоящий: Activity его не прячет.
    function App() {
      const [url, setUrl] = useState<SavedSort<Key> | null>(null);
      return (
        <>
          <output>{url ? `${url.key} ${url.dir}` : "по умолчанию"}</output>
          <Page
            visible
            inUrl={url !== null}
            apply={(saved) => {
              apply(saved);
              setUrl(saved);
            }}
          />
        </>
      );
    }
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    // Эффект запущен дважды — сортировка применена дважды, одна и та же; итог — она.
    expect(apply).toHaveBeenCalledTimes(2);
    for (const [saved] of apply.mock.calls) expect(saved).toEqual(SAVED);
    expect(screen.getByRole("status").textContent).toBe("pnl desc");
  });
});
