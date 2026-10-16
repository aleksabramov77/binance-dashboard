import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { experimentsTable } from "../model/db";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import {
  readMirrorAutoRows,
  saveMirrorAuto,
  setExperimentMirrorMode,
} from "./mirrorAutoDb";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

const exp = (id: string, over: Partial<Experiment> = {}): Experiment => ({
  id,
  market: "spot",
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
  ...over,
});

const closed = (
  id: string,
  runId: number,
  experimentId: string,
  openedAt: string,
  rMultiple: number | null,
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market: "spot",
  symbol: "ETHUSDT",
  direction: "long",
  openedAt,
  entryPrice: 100,
  quantity: 0.5,
  initialStop: 95,
  stop: 95,
  takeProfit: 110,
  atr: 1,
  extreme: 100,
  checkedUntil: 0,
  closedAt: new Date(Date.parse(openedAt) + 60_000).toISOString(),
  exitPrice: 105,
  exitReason: "tp",
  fees: 0,
  pnl: 2.5,
  rMultiple,
  demoOrderRef: null,
  mae: null,
  entryContext: {},
  signal: {},
});

const row = async (id: string) => {
  const [r] = await db
    .select()
    .from(experimentsTable)
    .where(eq(experimentsTable.id, id));
  return r;
};

describe("авто-зеркало в БД (spec 0043)", () => {
  it("сид: demoMirror true — ручное «Вкл», иначе «Авто»", async () => {
    await seedExperiments(db, [exp("PS99", { demoMirror: true }), exp("S98")]);
    expect((await row("PS99")).demoMirrorMode).toBe("on");
    expect((await row("S98")).demoMirrorMode).toBe("auto");
  });

  it("ручные положения ставят флаг и начало окна; «Авто» флаг не трогает; смена положения сбрасывает подсказку", async () => {
    await seedExperiments(db, [exp("S98")]);
    await db
      .update(experimentsTable)
      .set({ demoMirrorAdvice: "on", demoMirrorMode: "off" })
      .where(eq(experimentsTable.id, "S98"));

    // То же положение — подсказка остаётся.
    expect(await setExperimentMirrorMode(db, "S98", "off")).toBe(true);
    expect((await row("S98")).demoMirrorAdvice).toBe("on");
    expect((await row("S98")).demoMirrorSince).toBeNull();

    expect(await setExperimentMirrorMode(db, "S98", "on")).toBe(true);
    const on = await row("S98");
    expect(on).toMatchObject({
      demoMirror: true,
      demoMirrorMode: "on",
      demoMirrorAdvice: null,
    });
    expect(on.demoMirrorSince).not.toBeNull();

    expect(await setExperimentMirrorMode(db, "S98", "auto")).toBe(true);
    const auto = await row("S98");
    expect(auto).toMatchObject({ demoMirror: true, demoMirrorMode: "auto" });
    expect(auto.demoMirrorSince).toEqual(on.demoMirrorSince);
  });

  it("«Вкл» для COIN-M и неизвестного id — false", async () => {
    await seedExperiments(db, [exp("PC99", { market: "coinm" })]);
    expect(await setExperimentMirrorMode(db, "PC99", "on")).toBe(false);
    expect(await setExperimentMirrorMode(db, "nope", "off")).toBe(false);
    expect((await row("PC99")).demoMirror).toBe(false);
  });

  it("решение автомата пишется, только пока положение то же", async () => {
    await seedExperiments(db, [exp("S98")]);
    const snapshot = {
      at: "2026-10-16T07:00:00.000Z",
      decision: "enable" as const,
      demoMirror: true,
      trades: 34,
      avgR: 0.21,
    };
    expect(
      await saveMirrorAuto(db, "S98", "on", { demoMirror: true, snapshot }),
    ).toBe(false);
    expect((await row("S98")).demoMirror).toBe(false);
    expect(
      await saveMirrorAuto(db, "S98", "auto", { demoMirror: true, snapshot }),
    ).toBe(true);
    const r = await row("S98");
    expect(r.demoMirror).toBe(true);
    expect(r.demoMirrorSince).not.toBeNull();
    expect(r.demoMirrorAuto).toEqual(snapshot);
    // Флаг уже такой — повтор не меняет начало окна.
    expect(await saveMirrorAuto(db, "S98", "auto", { demoMirror: true })).toBe(
      false,
    );
  });

  it("данные для решения: группы с демо-зеркалом, закрытые сделки текущей эпохи с R по порядку закрытия", async () => {
    await seedExperiments(db, [exp("S98"), exp("PC99", { market: "coinm" })]);
    const runId = await ensureRun(db);
    const store = createDbExperimentStore(db);
    await store.insertTrade(
      closed("b", runId, "S98", "2026-10-11T12:00:00.000Z", -0.5),
    );
    await store.insertTrade(
      closed("a", runId, "S98", "2026-10-11T10:00:00.000Z", 1),
    );
    // Без стопа R нет — не считается.
    await store.insertTrade(
      closed("c", runId, "S98", "2026-10-11T11:00:00.000Z", null),
    );
    await store.insertTrade(
      closed("d", runId, "PC99", "2026-10-11T11:00:00.000Z", 1),
    );
    const data = await readMirrorAutoRows(db);
    expect(data?.rows.map((r) => r.id)).toEqual(["S98"]);
    expect(data?.rows[0].trades.map((t) => t.rMultiple)).toEqual([1, -0.5]);
    expect(data?.rows[0]).toMatchObject({
      mode: "auto",
      advice: null,
      demoMirror: false,
    });
    expect((await readMirrorAutoRows(db, ["PC99"]))?.rows).toEqual([]);
  });
});
