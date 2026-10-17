import { describe, expect, it, vi } from "vitest";
import { createDbExperimentStore } from "@/entities/experiment";
import { ENGINE_KEYS } from "@/features/paper-engine";
import { createMemoryDb } from "@/shared/db/client.server";
import {
  type BackgroundJob,
  backgroundJobs,
  createJobsState,
  type JobGate,
  type JobLog,
  readDbRunner,
  runBackgroundJob,
  scheduleJobs,
} from "./backgroundJobs";
import { parseCron } from "./backgroundSchedule";

vi.mock("./backgroundSchedule", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./backgroundSchedule")>();
  return { ...mod, parseCron: vi.fn(mod.parseCron) };
});

// Гейт фоновых задач VM (spec 0048) на фейках: без БД, биржи и таймеров.
const fakeLog = (): JobLog => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

const gate = (over: Partial<JobGate> = {}): JobGate => ({
  serverless: () => false,
  processRunner: () => "oracle",
  dbRunner: async () => "oracle",
  ...over,
});

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: "earn-snapshot",
  cron: "0 3,15 * * *",
  offsetMs: 0,
  event: "cron.earn",
  quiet: false,
  run: vi.fn(async () => ({ offers: 3 })),
  ...over,
});

const running = createJobsState;

describe("runBackgroundJob", () => {
  it("все условия выполнены — задача идёт, успех пишется событием роута", async () => {
    const j = job();
    const log = fakeLog();
    const r = running();
    expect(await runBackgroundJob(j, r, gate(), log)).toBe("done");
    expect(j.run).toHaveBeenCalledOnce();
    expect(log.info).toHaveBeenCalledWith(
      "cron.earn",
      expect.stringContaining("earn-snapshot"),
      expect.objectContaining({ job: "earn-snapshot", offers: 3 }),
    );
    expect(log.debug).not.toHaveBeenCalled();
    expect(r.running.size).toBe(0);
  });

  it("quiet-задача: успех в журнал не пишется", async () => {
    const log = fakeLog();
    const j = job({ id: "demo-mirror", event: "cron.mirror", quiet: true });
    expect(await runBackgroundJob(j, running(), gate(), log)).toBe("done");
    expect(log.info).not.toHaveBeenCalled();
  });

  it("на Vercel — пропуск: одна запись debug, runner из БД не читается", async () => {
    const j = job();
    const log = fakeLog();
    const dbRunner = vi.fn(async () => "oracle" as const);
    const outcome = await runBackgroundJob(
      j,
      running(),
      gate({ serverless: () => true, dbRunner }),
      log,
    );
    expect(outcome).toBe("skipped-serverless");
    expect(j.run).not.toHaveBeenCalled();
    expect(dbRunner).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("runner в БД — другой раннер (supabase) — пропуск: одна запись debug", async () => {
    const j = job();
    const log = fakeLog();
    const r = running();
    const outcome = await runBackgroundJob(
      j,
      r,
      gate({ dbRunner: async () => "supabase" }),
      log,
    );
    expect(outcome).toBe("skipped-runner");
    expect(j.run).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.debug).toHaveBeenCalledWith(
      "cron.earn",
      expect.any(String),
      expect.objectContaining({
        processRunner: "oracle",
        dbRunner: "supabase",
      }),
    );
    expect(log.info).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(r.running.size).toBe(0);
  });

  it("пустая база (runner не задан, spec 0059) — пропуск, задача не выполняется", async () => {
    const j = job();
    const log = fakeLog();
    const outcome = await runBackgroundJob(
      j,
      running(),
      gate({ dbRunner: async () => null }),
      log,
    );
    expect(outcome).toBe("skipped-runner-unset");
    expect(j.run).not.toHaveBeenCalled();
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("readDbRunner: новая база SQLite — null (не раннер по умолчанию); после переноса — значение из БД", async () => {
    const { db, close } = await createMemoryDb();
    try {
      expect(await readDbRunner(db)).toBeNull();
      await createDbExperimentStore(db).setState(ENGINE_KEYS.runner, "oracle");
      expect(await readDbRunner(db)).toBe("oracle");
      await createDbExperimentStore(db).setState(
        ENGINE_KEYS.runner,
        "supabase",
      );
      expect(await readDbRunner(db)).toBe("supabase");
    } finally {
      await close();
    }
  });

  it("прошлый запуск ещё идёт — второй пропускается, после окончания — снова идёт", async () => {
    let finish = () => {};
    const j = job({
      run: vi.fn(
        () =>
          new Promise<undefined>((resolve) => {
            finish = () => resolve(undefined);
          }),
      ),
    });
    const log = fakeLog();
    const r = running();
    const first = runBackgroundJob(j, r, gate(), log);
    // Даём первому дойти до job.run (после чтения runner из БД).
    await vi.waitFor(() => expect(j.run).toHaveBeenCalledOnce());
    expect(await runBackgroundJob(j, r, gate(), log)).toBe("skipped-running");
    expect(log.debug).toHaveBeenCalledOnce();
    expect(j.run).toHaveBeenCalledOnce();
    finish();
    expect(await first).toBe("done");
    const again = runBackgroundJob(j, r, gate(), log);
    await vi.waitFor(() => expect(j.run).toHaveBeenCalledTimes(2));
    finish();
    expect(await again).toBe("done");
  });

  it("идущая задача не блокирует другую", async () => {
    const r = running();
    r.running.add("demo-mirror");
    expect(await runBackgroundJob(job(), r, gate(), fakeLog())).toBe("done");
  });

  it("сбой задачи — error с событием роута, наружу не бросает, следующий запуск идёт", async () => {
    const boom = new Error("Binance недоступен");
    const run = vi
      .fn<BackgroundJob["run"]>()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce(undefined);
    const j = job({ id: "mirror-auto", event: "cron.mirror_auto", run });
    const log = fakeLog();
    const r = running();
    expect(await runBackgroundJob(j, r, gate(), log)).toBe("failed");
    expect(log.error).toHaveBeenCalledWith(
      "cron.mirror_auto",
      expect.any(String),
      expect.objectContaining({ job: "mirror-auto" }),
      boom,
    );
    expect(r.running.size).toBe(0);
    expect(await runBackgroundJob(j, r, gate(), log)).toBe("done");
  });

  it("сбой чтения runner из БД — пропуск «раннер неизвестен»: warn, не error, задача не идёт", async () => {
    const j = job();
    const log = fakeLog();
    const r = running();
    const boom = new Error("БД недоступна");
    const outcome = await runBackgroundJob(
      j,
      r,
      gate({
        dbRunner: async () => {
          throw boom;
        },
      }),
      log,
    );
    expect(outcome).toBe("skipped-runner-unknown");
    expect(j.run).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(
      "cron.earn",
      expect.stringContaining("раннер неизвестен"),
      expect.objectContaining({
        job: "earn-snapshot",
        reason: "skipped-runner-unknown",
        processRunner: "oracle",
      }),
      boom,
    );
    expect(r.running.size).toBe(0);
  });

  it("ms прогона считается один раз: в тексте и в данных одно значение", async () => {
    const log = fakeLog();
    let t = 1_000;
    // Каждый вызов часов сдвигает время: два вызова дали бы разные числа.
    const now = () => {
      t += 7;
      return t;
    };
    expect(await runBackgroundJob(job(), running(), gate(), log, now)).toBe(
      "done",
    );
    expect(log.info).toHaveBeenCalledWith(
      "cron.earn",
      "earn-snapshot: выполнено за 7 мс",
      expect.objectContaining({ ms: 7 }),
    );
  });
});

describe("runBackgroundJob — раннер неизвестен", () => {
  const failing: JobGate["dbRunner"] = async () => {
    throw new Error("БД недоступна");
  };

  it("сбой чтения каждую минуту — одна строка warn на серию", async () => {
    const j = job({ id: "demo-mirror", event: "cron.mirror", quiet: true });
    const log = fakeLog();
    const s = createJobsState();
    const g = gate({ dbRunner: failing });
    for (let i = 0; i < 5; i++)
      expect(await runBackgroundJob(j, s, g, log)).toBe(
        "skipped-runner-unknown",
      );
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("БД вернулась — задача снова идёт (одна строка), новый сбой — снова warn", async () => {
    const j = job({ id: "demo-mirror", event: "cron.mirror", quiet: true });
    const log = fakeLog();
    const s = createJobsState();
    let down = true;
    const g = gate({
      dbRunner: async () => {
        if (down) throw new Error("БД недоступна");
        return "oracle";
      },
    });
    expect(await runBackgroundJob(j, s, g, log)).toBe("skipped-runner-unknown");
    down = false;
    expect(await runBackgroundJob(j, s, g, log)).toBe("done");
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.debug).toHaveBeenLastCalledWith(
      "cron.mirror",
      expect.stringContaining("снова выполняется"),
      expect.anything(),
    );
    down = true;
    expect(await runBackgroundJob(j, s, g, log)).toBe("skipped-runner-unknown");
    expect(log.warn).toHaveBeenCalledTimes(2);
  });

  it("смена «другой раннер» → «неизвестен» → «другой раннер» — по строке на каждую смену", async () => {
    const j = job();
    const log = fakeLog();
    const s = createJobsState();
    const other = gate({ dbRunner: async () => "supabase" });
    await runBackgroundJob(j, s, other, log);
    await runBackgroundJob(j, s, gate({ dbRunner: failing }), log);
    await runBackgroundJob(j, s, other, log);
    expect(log.debug).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledOnce();
  });
});

describe("runBackgroundJob — строки пропуска только при смене состояния", () => {
  it("два пропуска подряд — одна строка; снова запустилась — одна строка; новый пропуск — снова строка", async () => {
    const j = job({ id: "demo-mirror", event: "cron.mirror", quiet: true });
    const log = fakeLog();
    const s = createJobsState();
    let dbRunner: "oracle" | "supabase" = "supabase";
    const g = gate({ dbRunner: async () => dbRunner });

    expect(await runBackgroundJob(j, s, g, log)).toBe("skipped-runner");
    expect(await runBackgroundJob(j, s, g, log)).toBe("skipped-runner");
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.debug).toHaveBeenLastCalledWith(
      "cron.mirror",
      expect.stringContaining("другой раннер"),
      expect.objectContaining({ reason: "skipped-runner" }),
    );

    dbRunner = "oracle";
    expect(await runBackgroundJob(j, s, g, log)).toBe("done");
    expect(await runBackgroundJob(j, s, g, log)).toBe("done");
    expect(log.debug).toHaveBeenCalledTimes(2);
    expect(log.debug).toHaveBeenLastCalledWith(
      "cron.mirror",
      expect.stringContaining("снова выполняется"),
      expect.anything(),
    );

    dbRunner = "supabase";
    expect(await runBackgroundJob(j, s, g, log)).toBe("skipped-runner");
    expect(log.debug).toHaveBeenCalledTimes(3);
  });

  it("«прошлый запуск ещё идёт» — тоже одна строка на серию", async () => {
    const j = job();
    const log = fakeLog();
    const s = createJobsState();
    s.running.add(j.id);
    expect(await runBackgroundJob(j, s, gate(), log)).toBe("skipped-running");
    expect(await runBackgroundJob(j, s, gate(), log)).toBe("skipped-running");
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.debug).toHaveBeenCalledWith(
      "cron.earn",
      expect.stringContaining("ещё идёт"),
      expect.objectContaining({ reason: "skipped-running" }),
    );
  });

  it("смена причины пропуска — новая строка", async () => {
    const j = job();
    const log = fakeLog();
    const s = createJobsState();
    await runBackgroundJob(
      j,
      s,
      gate({ dbRunner: async () => "supabase" }),
      log,
    );
    s.running.add(j.id);
    await runBackgroundJob(j, s, gate(), log);
    expect(log.debug).toHaveBeenCalledTimes(2);
  });

  it("состояние у каждой задачи своё", async () => {
    const log = fakeLog();
    const s = createJobsState();
    const g = gate({ dbRunner: async () => "supabase" });
    await runBackgroundJob(job(), s, g, log);
    await runBackgroundJob(
      job({ id: "mirror-auto", event: "cron.mirror_auto" }),
      s,
      g,
      log,
    );
    expect(log.debug).toHaveBeenCalledTimes(2);
  });
});

describe("backgroundJobs", () => {
  it("четыре задачи pg_cron с событиями роутов", () => {
    expect(backgroundJobs().map((j) => [j.id, j.event, typeof j.run])).toEqual([
      ["earn-snapshot", "cron.earn", "function"],
      ["log-monitor", "cron.monitor", "function"],
      ["demo-mirror", "cron.mirror", "function"],
      ["mirror-auto", "cron.mirror_auto", "function"],
    ]);
  });
});

describe("scheduleJobs", () => {
  it("разбирает расписание каждой задачи один раз, при старте", () => {
    const parse = vi.mocked(parseCron);
    parse.mockClear();
    const scheduled = scheduleJobs(backgroundJobs());
    expect(parse).toHaveBeenCalledTimes(scheduled.length);
    expect(scheduled.map((s) => s.job.id)).toEqual([
      "earn-snapshot",
      "log-monitor",
      "demo-mirror",
      "mirror-auto",
    ]);
    expect(scheduled[0].schedule.hours).toEqual(new Set([3, 15]));
  });

  it("ошибка в cron — видна при старте", () => {
    expect(() => scheduleJobs([job({ cron: "* * 1 * *" })])).toThrow();
  });
});
