import { describe, expect, it } from "vitest";
import {
  liveLogsHref,
  logFiltersSearch,
  mirrorLogsHref,
  parseLogFilters,
} from "./filters";

describe("parseLogFilters", () => {
  it("значения по умолчанию", () => {
    expect(parseLogFilters(new URLSearchParams(""))).toEqual({
      level: "info",
      events: [],
      experiment: "",
      days: 2,
    });
  });
  it("события списком, days зажат в 1…14, неизвестный уровень → info", () => {
    expect(
      parseLogFilters(
        new URLSearchParams("level=x&event=a, b,,c&experiment=F03&days=99"),
      ),
    ).toEqual({
      level: "info",
      events: ["a", "b", "c"],
      experiment: "F03",
      days: 14,
    });
    expect(parseLogFilters(new URLSearchParams("days=0")).days).toBe(1);
    expect(parseLogFilters(new URLSearchParams("days=abc")).days).toBe(2);
  });
});

describe("logFiltersSearch / mirrorLogsHref", () => {
  it("не пишет значения по умолчанию", () => {
    expect(logFiltersSearch({})).toBe("");
    expect(
      logFiltersSearch({ level: "warn", events: ["a", "b"], days: 14 }),
    ).toBe("?level=warn&event=a%2Cb&days=14");
  });
  it("ссылка на отказы и пропуски эксперимента", () => {
    expect(mirrorLogsHref("F03")).toBe(
      "/logs?event=mirror.rejected%2Cmirror.skipped&experiment=F03&days=14",
    );
  });
  it("ссылка на отказы и пропуски реального счёта", () => {
    expect(liveLogsHref("S98")).toBe(
      "/logs?event=live.rejected%2Clive.skipped%2Clive.reconcile&experiment=S98&days=14",
    );
  });
});
