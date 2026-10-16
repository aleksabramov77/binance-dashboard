import type { Experiment } from "@binance-dashboard/trading-core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { experimentsTable, liveMirrorOrdersTable } from "../model/db";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import { closeLiveWithAuto } from "./liveAutoDb";

// Закрытие реальной сделки и автовыключение — одна синхронная транзакция SQLite с блокировкой записи сразу
// (BEGIN IMMEDIATE, spec 0059 вместо SELECT … FOR UPDATE). Id — фиктивные.
let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
  const exp: Experiment = {
    id: "S96",
    market: "usdm",
    name: "S96",
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
  await seedExperiments(db, [exp]);
  const runId = await ensureRun(db);
  await createDbExperimentStore(db).insertTrade({
    id: "t1",
    runId,
    experimentId: "S96",
    market: "usdm",
    symbol: "BTCUSDT",
    direction: "long",
    openedAt: new Date(Date.now() - 60_000).toISOString(),
    entryPrice: 100,
    quantity: 1,
    initialStop: 95,
    stop: 95,
    takeProfit: 110,
    atr: 1,
    extreme: 100,
    checkedUntil: 0,
    closedAt: null,
    exitPrice: null,
    exitReason: null,
    fees: 0,
    pnl: null,
    rMultiple: null,
    demoOrderRef: null,
    mae: null,
    entryContext: {},
    signal: {},
  });
  await db
    .update(experimentsTable)
    .set({
      liveMirror: true,
      liveMirrorMode: "on_autooff",
      liveMirrorSince: new Date(Date.now() - 120_000),
      liveLossLimitUsd: 10,
    })
    .where(eq(experimentsTable.id, "S96"));
  await db.insert(liveMirrorOrdersTable).values({
    tradeId: "t1",
    experimentId: "S96",
    market: "usdm",
    symbol: "BTCUSDT",
    direction: "long",
    status: "closing",
  });
});
afterEach(() => close());

const lossPatch = {
  status: "closed" as const,
  message: "закрыто",
  steps: [],
  realizedPnl: -15,
  closed: true,
};

const state = async () => {
  const [row] = await db.select().from(liveMirrorOrdersTable);
  const [exp] = await db.select().from(experimentsTable);
  return {
    status: row?.status,
    pnl: row?.realizedPnl,
    mode: exp?.liveMirrorMode,
    on: exp?.liveMirror,
  };
};

describe("closeLiveWithAuto", () => {
  it("убыток за порогом: строка закрыта и «Вкл + автовыкл» → «Выкл» в одной транзакции", async () => {
    const out = await closeLiveWithAuto(
      db,
      "t1",
      lossPatch,
      ["closing"],
      () => "убыток",
    );
    expect(out.closed).toBe(true);
    expect(out.auto?.disabledReason).toBe("убыток");
    expect(await state()).toEqual({
      status: "closed",
      pnl: -15,
      mode: "off",
      on: false,
    });
  });

  it("сбой после закрытия строки (решение по порогам) — откат: строка снова «закрывается», режим прежний", async () => {
    await expect(
      closeLiveWithAuto(db, "t1", lossPatch, ["closing"], () => {
        throw new Error("сбой");
      }),
    ).rejects.toThrow("сбой");
    expect(await state()).toEqual({
      status: "closing",
      pnl: null,
      mode: "on_autooff",
      on: true,
    });
  });

  it("транзакция берёт блокировку записи сразу (BEGIN IMMEDIATE)", async () => {
    const spy = vi.spyOn(db, "transaction");
    await closeLiveWithAuto(db, "t1", lossPatch, ["closing"], () => "убыток");
    expect(spy).toHaveBeenCalledWith(expect.any(Function), {
      behavior: "immediate",
    });
  });

  it("повтор итога (строка уже не в from) — ничего не решаем", async () => {
    await closeLiveWithAuto(db, "t1", lossPatch, ["closing"], () => "убыток");
    expect(
      await closeLiveWithAuto(db, "t1", lossPatch, ["closing"], () => "убыток"),
    ).toEqual({ closed: false, auto: null });
  });
});
