import { describe, expect, it } from "vitest";
import { withMirrorRunLock } from "./mirrorLock";

// Блокировка прогона зеркала в памяти процесса (spec 0059): база — файл SQLite одного процесса.
describe("withMirrorRunLock", () => {
  it("второй прогон, пока идёт первый, — acquired: false; после первого — снова можно", async () => {
    let release = () => {};
    const first = withMirrorRunLock(
      () => new Promise<string>((r) => (release = () => r("first"))),
    );
    let called = false;
    expect(
      await withMirrorRunLock(async () => {
        called = true;
        return "second";
      }),
    ).toEqual({ acquired: false });
    expect(called).toBe(false);
    release();
    expect(await first).toEqual({ acquired: true, value: "first" });
    expect(await withMirrorRunLock(async () => "again")).toEqual({
      acquired: true,
      value: "again",
    });
  });

  it("ошибка прогона — блокировка снимается", async () => {
    await expect(
      withMirrorRunLock(async () => Promise.reject(new Error("сбой"))),
    ).rejects.toThrow("сбой");
    expect(await withMirrorRunLock(async () => 1)).toEqual({
      acquired: true,
      value: 1,
    });
  });
});
