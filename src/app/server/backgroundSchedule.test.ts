import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BACKGROUND_JOBS, nextRunAt, parseCron } from "./backgroundSchedule";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe("parseCron", () => {
  it("минуты и часы: *, */n, число, список", () => {
    const s = parseCron("*/15 3,15 * * *");
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([3, 15]);
    expect(parseCron("* * * * *").minutes.size).toBe(60);
    expect(parseCron("* * * * *").hours.size).toBe(24);
  });

  it("неподдерживаемое — ошибка, а не молча другое расписание", () => {
    expect(() => parseCron("0 7 * * 1")).toThrow();
    expect(() => parseCron("0 7 * *")).toThrow();
    expect(() => parseCron("60 * * * *")).toThrow();
    expect(() => parseCron("0 24 * * *")).toThrow();
    expect(() => parseCron("*/0 * * * *")).toThrow();
    expect(() => parseCron("1-5 * * * *")).toThrow();
  });
});

describe("nextRunAt — расписания pg_cron (UTC)", () => {
  it("снимок Earn 0 3,15 * * *: 03:00 и 15:00, после 15:00 — завтра 03:00", () => {
    const s = parseCron("0 3,15 * * *");
    expect(iso(nextRunAt(s, at("2026-10-16T01:00:00Z")))).toBe(
      "2026-10-16T03:00:00.000Z",
    );
    expect(iso(nextRunAt(s, at("2026-10-16T03:00:00Z")))).toBe(
      "2026-10-16T15:00:00.000Z",
    );
    expect(iso(nextRunAt(s, at("2026-10-16T15:00:00.001Z")))).toBe(
      "2026-10-17T03:00:00.000Z",
    );
  });

  it("монитор */15 * * * *: ближайшая четверть часа", () => {
    const s = parseCron("*/15 * * * *");
    expect(iso(nextRunAt(s, at("2026-10-16T10:07:12Z")))).toBe(
      "2026-10-16T10:15:00.000Z",
    );
    expect(iso(nextRunAt(s, at("2026-10-16T10:45:00Z")))).toBe(
      "2026-10-16T11:00:00.000Z",
    );
    expect(iso(nextRunAt(s, at("2026-10-16T23:59:59Z")))).toBe(
      "2026-10-17T00:00:00.000Z",
    );
  });

  it("демо-зеркало * * * * * со смещением 20 с — после тика той же минуты", () => {
    const s = parseCron("* * * * *");
    expect(iso(nextRunAt(s, at("2026-10-16T10:07:05Z"), 20_000))).toBe(
      "2026-10-16T10:07:20.000Z",
    );
    expect(iso(nextRunAt(s, at("2026-10-16T10:07:20Z"), 20_000))).toBe(
      "2026-10-16T10:08:20.000Z",
    );
    expect(iso(nextRunAt(s, at("2026-10-16T10:07:59.999Z"), 20_000))).toBe(
      "2026-10-16T10:08:20.000Z",
    );
  });

  it("авто-зеркало 0 7 * * *: раз в сутки, через границу месяца", () => {
    const s = parseCron("0 7 * * *");
    expect(iso(nextRunAt(s, at("2026-10-31T07:00:00Z")))).toBe(
      "2026-11-01T07:00:00.000Z",
    );
    expect(iso(nextRunAt(s, at("2026-10-16T06:59:59Z")))).toBe(
      "2026-10-16T07:00:00.000Z",
    );
  });

  it("всегда строго позже now", () => {
    const s = parseCron("* * * * *");
    for (const now of [0, 59_999, 60_000, 60_001])
      expect(nextRunAt(s, now)).toBeGreaterThan(now);
  });

  it("смещение вне минуты — ошибка", () => {
    const s = parseCron("* * * * *");
    expect(() => nextRunAt(s, 0, 60_000)).toThrow();
    expect(() => nextRunAt(s, 0, -1)).toThrow();
  });
});

describe("BACKGROUND_JOBS", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith("_cron.sql"))
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n");

  it.each(BACKGROUND_JOBS)("$id — то же расписание, что у pg_cron", (job) => {
    const m = new RegExp(
      `cron\\.schedule\\(\\s*'${job.id}',\\s*'([^']+)'`,
    ).exec(sql);
    expect(m?.[1]).toBe(job.cron);
    expect(() => parseCron(job.cron)).not.toThrow();
  });
});
