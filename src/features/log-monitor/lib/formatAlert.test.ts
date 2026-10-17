import { describe, expect, it } from "vitest";
import type { Issue } from "./detectIssues";
import { formatAlert } from "./formatAlert";

const issue: Issue = {
  key: "tick:stale",
  severity: "critical",
  title: "Тик движка молчит",
  details: "нет тика 10 мин",
};

describe("ссылка на журнал в тревоге", () => {
  it("с адресом сайта — последней строкой", () => {
    const text = formatAlert({
      notify: [issue],
      resolved: [],
      analysis: null,
      logsUrl: "https://binance.example.test/logs",
    });
    expect(text?.split("\n").at(-1)).toBe(
      "Журнал: https://binance.example.test/logs",
    );
  });

  it("без адреса сайта — без строки журнала", () => {
    const text = formatAlert({
      notify: [issue],
      resolved: [],
      analysis: null,
      logsUrl: null,
    });
    expect(text).toBe(
      "⚠️ Binance Dashboard: проблема\n🔴 Тик движка молчит: нет тика 10 мин",
    );
  });
});
