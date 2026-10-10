import { describe, expect, it } from "vitest";
import { createLimiter } from "./limiter";

describe("ограничитель параллельности", () => {
  it("не запускает больше n задач одновременно и выполняет все", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const task = (v: number) =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 1));
        active--;
        return v;
      });
    const out = await Promise.all([1, 2, 3, 4, 5].map(task));
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });
});
