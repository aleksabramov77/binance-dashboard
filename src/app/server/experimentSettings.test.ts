import type { Experiment } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureRun,
  experimentsTable,
  seedExperiments,
} from "@/entities/experiment";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { setDemoMirrorMode } from "./experimentSettings";

// Положение демо-зеркала через сервер (spec 0043): БД — PGlite в памяти, движок, биржа и журнал — моки.
let db: Db;
let close: () => Promise<void>;

vi.mock("@/shared/db/client.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/db/client.server")>()),
  getDb: () => db,
}));
vi.mock("./experimentEngine", () => ({
  ensureEngineReady: async () => {},
  warnInvalidExperiment: vi.fn(),
  withTickLock: <T>(fn: () => Promise<T>) => fn(),
}));
vi.mock("./mirrorAuto", () => ({ runMirrorAuto: vi.fn() }));
vi.mock("@/shared/api/binance/demo.server", () => ({
  fetchDemoUsdtBalances: vi.fn(async () => ({ spot: 0, usdm: 0 })),
}));
vi.mock("@/shared/lib/logger.server", () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const exp = (id: string, market: Experiment["market"]): Experiment => ({
  id,
  market,
  name: id,
  hypothesis: "тест",
  config: {
    timeframe: "1h",
    entry: { type: "hold" },
    exit: { stop: { type: "none" }, takeProfit: null },
    universe: { type: "majors" },
    directions: ["long"],
    maxOpen: 1,
  },
  initialBudget: 10_000,
  enabled: true,
  demoMirror: false,
});

beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  await seedExperiments(db, [exp("S98", "spot"), exp("PC99", "coinm")]);
  await ensureRun(db);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await close();
});

const mode = async (id: string) =>
  (
    await db
      .select({ mode: experimentsTable.demoMirrorMode })
      .from(experimentsTable)
      .where(eq(experimentsTable.id, id))
  )[0].mode;

describe("setDemoMirrorMode", () => {
  it("«Вкл» без ключа Binance Demo — отказ с причиной, положение не меняется", async () => {
    vi.stubEnv("BINANCE_DEMO_API_KEY", "");
    expect(await setDemoMirrorMode("S98", "on")).toEqual({
      blocked: expect.stringMatching(/ключ Binance Demo/),
    });
    expect(await mode("S98")).toBe("auto");
  });

  it("COIN-M — прежняя причина; «Выкл» без ключа можно; неизвестный id — null", async () => {
    vi.stubEnv("BINANCE_DEMO_API_KEY", "k");
    vi.stubEnv("BINANCE_DEMO_API_SECRET", "s");
    expect(await setDemoMirrorMode("PC99", "on")).toEqual({
      blocked: expect.stringMatching(/COIN-M/),
    });
    vi.stubEnv("BINANCE_DEMO_API_KEY", "");
    const off = await setDemoMirrorMode("S98", "off");
    expect(off && "epoch" in off).toBe(true);
    expect(await mode("S98")).toBe("off");
    expect(await setDemoMirrorMode("nope", "off")).toBeNull();
  });
});
