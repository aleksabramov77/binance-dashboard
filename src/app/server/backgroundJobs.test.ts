import { describe, expect, it, vi } from "vitest";
import {
  type BackgroundJob,
  backgroundJobs,
  type JobGate,
  type JobLog,
  runBackgroundJob,
} from "./backgroundJobs";
import type { BackgroundJobId } from "./backgroundSchedule";

// Гейт фоновых задач VM (spec 0048) на фейках: без БД, биржи и таймеров.
const fakeLog = (): JobLog => ({
  debug: vi.fn(),
  info: vi.fn(),
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

const running = () => new Set<BackgroundJobId>();

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
    expect(r.size).toBe(0);
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
    expect(r.size).toBe(0);
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
    r.add("demo-mirror");
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
    expect(r.size).toBe(0);
    expect(await runBackgroundJob(j, r, gate(), log)).toBe("done");
  });

  it("сбой чтения runner из БД — тоже error задачи, без броска", async () => {
    const j = job();
    const log = fakeLog();
    const outcome = await runBackgroundJob(
      j,
      running(),
      gate({
        dbRunner: async () => {
          throw new Error("БД недоступна");
        },
      }),
      log,
    );
    expect(outcome).toBe("failed");
    expect(j.run).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledOnce();
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
