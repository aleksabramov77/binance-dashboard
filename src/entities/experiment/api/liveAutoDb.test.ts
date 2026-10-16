import type { Experiment } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { experimentsTable } from "../model/db";
import { ensureRun, seedExperiments } from "./dbStore";
import { readLiveAutoRows, setExperimentLiveMode } from "./liveAutoDb";

// Реальный счёт — свой список групп (spec 0056, AC9): демо-зеркало умеет COIN-M, а реальный счёт — нет.
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  await seedExperiments(db, [exp("PS99", "spot"), exp("PC99", "coinm")]);
  await ensureRun(db);
});
afterEach(() => close());

function exp(id: string, market: Experiment["market"]): Experiment {
  return {
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
  };
}

const liveOf = async (id: string) =>
  (
    await db
      .select({
        mode: experimentsTable.liveMirrorMode,
        on: experimentsTable.liveMirror,
      })
      .from(experimentsTable)
      .where(eq(experimentsTable.id, id))
  )[0];

describe("liveAutoDb: COIN-M на реальном счёте не торгуется (spec 0056, AC9)", () => {
  it("«Вкл» и «Авто» для COIN-M — null, положение не меняется; Spot — можно", async () => {
    for (const mode of ["on", "auto"] as const)
      expect(
        await setExperimentLiveMode(db, "PC99", mode, undefined, "test"),
      ).toBeNull();
    expect(await liveOf("PC99")).toEqual({ mode: "off", on: false });
    expect(
      await setExperimentLiveMode(db, "PS99", "auto", undefined, "test"),
    ).toEqual({ id: "PS99", liveMirror: false });
  });

  it("автомат реального счёта не читает эксперименты COIN-M, даже если положение не «Выкл»", async () => {
    await setExperimentLiveMode(db, "PS99", "auto", undefined, "test");
    // В обход переключателя (старые данные, ручная правка БД).
    await db
      .update(experimentsTable)
      .set({ liveMirrorMode: "auto" })
      .where(eq(experimentsTable.id, "PC99"));
    expect((await readLiveAutoRows(db)).rows.map((r) => r.id)).toEqual([
      "PS99",
    ]);
    expect((await readLiveAutoRows(db, ["PC99"])).rows).toEqual([]);
  });
});
