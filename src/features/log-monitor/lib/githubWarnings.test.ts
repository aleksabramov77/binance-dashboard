import { describe, expect, it } from "vitest";
import { githubWarnings } from "./githubWarnings";

describe("githubWarnings", () => {
  it("всё в порядке или GitHub не настроен — писать нечего", () => {
    expect(githubWarnings({ invalid: [], errors: [], repo: "me/r" })).toEqual(
      [],
    );
    expect(githubWarnings({ invalid: [], errors: [], repo: null })).toEqual([]);
  });

  it("сбой GitHub — warn monitor.github со всеми ошибками и репозиторием", () => {
    expect(
      githubWarnings({
        invalid: [],
        errors: [
          "http5xx:/api/x: GitHub GET /repos/me/r/issues 500: boom",
          "b",
        ],
        repo: "me/r",
      }),
    ).toEqual([
      {
        event: "monitor.github",
        message:
          "Сбой GitHub, задачи по тревогам: http5xx:/api/x: GitHub GET /repos/me/r/issues 500: boom; b",
        data: { repo: "me/r" },
      },
    ]);
  });

  it("нераспознанные настройки — отдельная запись", () => {
    const [w] = githubWarnings({
      invalid: ["ALERT_AUTOFIX_PER_DAY"],
      errors: [],
      repo: "me/r",
    });
    expect(w.event).toBe("monitor.github");
    expect(w.message).toContain("ALERT_AUTOFIX_PER_DAY");
  });
});
