import { afterEach, describe, expect, it, vi } from "vitest";
import { flushLogs, type LogEntry, log, setLogSink } from "./logger.server";

describe("приёмник журнала", () => {
  afterEach(() => {
    setLogSink(null);
    vi.unstubAllEnvs();
  });

  it("копит info+ и отдаёт пачкой; debug не уходит в БД", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("VERCEL", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const got: LogEntry[] = [];
    setLogSink(async (batch) => {
      got.push(...batch);
    });
    log.debug("a", "отладка");
    log.info("b", "инфо", { apiKey: "secret" });
    log.warn("c", "предупреждение");
    await flushLogs();
    expect(got.map((e) => e.event)).toEqual(["b", "c"]);
    expect(got[0].data).toEqual({ apiKey: "***" });
  });

  it("сбой приёмника не роняет вызывающего", async () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("VERCEL", "1");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setLogSink(async () => {
      throw new Error("БД недоступна");
    });
    log.info("b", "инфо");
    await expect(flushLogs()).resolves.toBeUndefined();
  });
});
