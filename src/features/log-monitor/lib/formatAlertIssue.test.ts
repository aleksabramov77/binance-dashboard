import { describe, expect, it } from "vitest";
import type { Issue } from "./detectIssues";
import { formatAlertIssue } from "./formatAlertIssue";

const issue: Issue = {
  key: "tick:stale",
  severity: "critical",
  title: "Тик движка молчит",
  details: "нет тика 10 мин",
};

describe("formatAlertIssue: ссылка на журнал", () => {
  it("с адресом сайта — последней строкой", () => {
    expect(
      formatAlertIssue(issue, null, [], "https://binance.example.test/logs")
        .body.split("\n")
        .at(-1),
    ).toBe("Журнал на сайте: https://binance.example.test/logs");
  });

  it("без адреса сайта — без строки журнала", () => {
    expect(formatAlertIssue(issue, null, [], null).body).not.toContain(
      "Журнал на сайте",
    );
  });
});
