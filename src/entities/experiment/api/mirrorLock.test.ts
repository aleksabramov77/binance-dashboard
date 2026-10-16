import { describe, expect, it, vi } from "vitest";
import { withMirrorRunLock } from "./mirrorLock";
import type { ExperimentDb } from "./tickLock";

/** Текст SQL-запроса Drizzle (куски строк) — чтобы проверить, что именно выполнено. */
const sqlText = (q: unknown) =>
  JSON.stringify((q as { queryChunks?: unknown }).queryChunks ?? q);

/** БД-заглушка: транзакция отвечает на pg_try_advisory_xact_lock заданным значением. */
const fakeDb = (locked: boolean) => {
  const execute = vi.fn(async (_q: unknown) => ({ rows: [{ locked }] }));
  const db = {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute }),
  } as unknown as ExperimentDb;
  return { db, execute };
};

describe("withMirrorRunLock", () => {
  it("Postgres: блокировка свободна — прогон идёт; занята другим сеансом — сразу выходим", async () => {
    const free = fakeDb(true);
    const fn = vi.fn(async () => "ok");
    expect(await withMirrorRunLock(free.db, fn, true)).toEqual({
      acquired: true,
      value: "ok",
    });
    // Замок взят — в той же транзакции таймаут простоя (SET LOCAL через set_config).
    expect(free.execute).toHaveBeenCalledTimes(2);
    expect(sqlText(free.execute.mock.calls[1]?.[0])).toContain(
      "idle_in_transaction_session_timeout",
    );

    const busy = fakeDb(false);
    const skipped = vi.fn(async () => "never");
    expect(await withMirrorRunLock(busy.db, skipped, true)).toEqual({
      acquired: false,
    });
    expect(skipped).not.toHaveBeenCalled();
    // Замок не взят — таймаут не ставим.
    expect(busy.execute).toHaveBeenCalledTimes(1);
  });

  it("второй одновременный прогон в процессе (PGlite) — locked; после первого — снова можно", async () => {
    const { db, execute } = fakeDb(true);
    let release = () => {};
    const first = withMirrorRunLock(
      db,
      () => new Promise<string>((r) => (release = () => r("first"))),
      false,
    );
    expect(await withMirrorRunLock(db, async () => "second", false)).toEqual({
      acquired: false,
    });
    release();
    expect(await first).toEqual({ acquired: true, value: "first" });
    // PGlite: транзакцию для блокировки не открываем.
    expect(execute).not.toHaveBeenCalled();
    expect(await withMirrorRunLock(db, async () => "again", false)).toEqual({
      acquired: true,
      value: "again",
    });
  });

  it("ошибка прогона — блокировка снимается", async () => {
    const { db } = fakeDb(true);
    await expect(
      withMirrorRunLock(
        db,
        async () => Promise.reject(new Error("сбой")),
        true,
      ),
    ).rejects.toThrow("сбой");
    expect(await withMirrorRunLock(db, async () => 1, true)).toEqual({
      acquired: true,
      value: 1,
    });
  });
});
