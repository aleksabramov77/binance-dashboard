import { readFileSync } from "node:fs";
import type { Experiment, PaperTrade } from "@binance-dashboard/trading-core";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import { demoMirrorOrdersTable, experimentsTable } from "../model/db";
import { createDbExperimentStore, ensureRun, seedExperiments } from "./dbStore";
import {
  activeMirrors,
  claimMirror,
  claimMirrorToClose,
  claimOpenMirrors,
  listMirrorCandidates,
  listMirrorsToClose,
  listOpenMirrorLegs,
  type MirrorCandidate,
  markDemoReset,
  markMirrorClosedByExchange,
  mirrorStatuses,
  mirrorSummaries,
  setExperimentDemoMirror,
  updateMirror,
} from "./mirrorDb";

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createMemoryDb());
});
afterEach(() => close());

const exp = (id: string): Experiment => ({
  id,
  market: "usdm",
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

const trade = (
  id: string,
  runId: number,
  experimentId: string,
  openedAt = "2026-10-11T11:55:00.000Z",
): PaperTrade => ({
  id,
  runId,
  experimentId,
  market: "usdm",
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

const SINCE = new Date("2026-10-11T11:00:00.000Z");

async function setup() {
  await seedExperiments(db, [exp("F01"), exp("F02")]);
  const runId = await ensureRun(db);
  const store = createDbExperimentStore(db);
  await store.insertTrade(trade("a", runId, "F01"));
  await store.insertTrade(trade("b", runId, "F02"));
  await store.insertTrade(
    trade("old", runId, "F01", "2026-10-11T09:00:00.000Z"),
  );
  return store;
}

describe("demo-зеркало в БД", () => {
  it("кандидаты — только свежие сделки экспериментов с зеркалом", async () => {
    await setup();
    expect(await listMirrorCandidates(db, SINCE)).toEqual([]);
    expect(await setExperimentDemoMirror(db, "F01", true)).toBe(true);
    expect(await setExperimentDemoMirror(db, "nope", true)).toBe(false);
    const list = await listMirrorCandidates(db, SINCE);
    expect(list.map((c) => c.tradeId)).toEqual(["a"]);
    expect(list[0]).toMatchObject({ stop: 95, takeProfit: 110, quantity: 0.5 });
  });

  it("захват идемпотентен, захваченная сделка не кандидат, зеркало активно", async () => {
    await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    expect(await claimMirror(db, c)).toBe(true);
    expect(await claimMirror(db, c)).toBe(false);
    expect(await listMirrorCandidates(db, SINCE)).toEqual([]);
    // Только что захвачена (pending): ссылки запишет вход — строка нового учёта.
    expect(await activeMirrors(db)).toEqual([
      {
        market: "usdm",
        symbol: "ETHUSDT",
        direction: "long",
        hasRefs: true,
      },
    ]);
  });

  it("закрытая paper-сделка с открытым зеркалом захватывается на закрытие один раз", async () => {
    // Свои стоп/тейк (PR 2b): сохраняются при входе и приходят в захвате на закрытие.
    const protectRefs = {
      market: "usdm" as const,
      entryOrderId: 11,
      legs: "quantity" as const,
      stop: { algoId: 21, clientAlgoId: "bd1-S" },
      takeProfit: { algoId: 22, clientAlgoId: "bd1-T" },
    };
    const store = await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      demoRef: "r1",
      entryPrice: 100,
      quantity: 0.5,
      protectRefs,
    });
    expect(await listMirrorsToClose(db)).toEqual([]);
    expect(await claimMirrorToClose(db, "a")).toBeNull();
    // С сохранёнными protect_refs — строка нового учёта (несколько зеркал на монету).
    expect(await activeMirrors(db)).toEqual([
      {
        market: "usdm",
        symbol: "ETHUSDT",
        direction: "long",
        hasRefs: true,
      },
    ]);

    await store.closeTrade("a", {
      closedAt: "2026-10-11T12:30:00.000Z",
      exitPrice: 104,
      exitReason: "trail",
      fees: 0.1,
      pnl: 1.9,
      rMultiple: 0.4,
    });
    expect(await listMirrorsToClose(db)).toEqual(["a"]);
    expect(await claimMirrorToClose(db, "a")).toEqual({
      tradeId: "a",
      market: "usdm",
      symbol: "ETHUSDT",
      direction: "long",
      quantity: 0.5,
      exitReason: "trail",
      protectRefs,
    });
    // Захвачена (closing) — второй прогон её не получит и в списке её нет.
    expect(await claimMirrorToClose(db, "a")).toBeNull();
    expect(await listMirrorsToClose(db)).toEqual([]);

    await updateMirror(db, "a", {
      status: "closed",
      message: "закрыта",
      steps: [],
      closed: true,
    });
    expect(await activeMirrors(db)).toEqual([]);
    expect(await mirrorStatuses(db, ["a", "b"])).toEqual(
      new Map([["a", { status: "closed", message: "закрыта" }]]),
    );
    const [paper] = (await store.openTrades(1)).filter((t) => t.id === "a");
    expect(paper).toBeUndefined();
  });
});

describe("демо-сводка и демо-сброс", () => {
  it("PnL по фактическому выходу зеркала, иначе по paper; сброс обнуляет и закрывает", async () => {
    const store = await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      entryPrice: 100,
      quantity: 0.5,
    });
    let summary = (await mirrorSummaries(db)).get("F01");
    expect(summary).toMatchObject({ trades: 1, open: 1, closed: 0 });

    // Демо-сброс: открытая позиция захватывается на закрытие, статистика начинается заново.
    const claimed = await claimOpenMirrors(db, "F01");
    expect(claimed.map((m) => m.tradeId)).toEqual(["a"]);
    expect(await claimOpenMirrors(db, null)).toEqual([]);
    await updateMirror(db, "a", {
      status: "closed",
      message: "сброс",
      steps: [],
      exitPrice: 104,
      closed: true,
    });
    summary = (await mirrorSummaries(db)).get("F01");
    expect(summary).toMatchObject({ closed: 1, wins: 1, pnl: 2 });

    await markDemoReset(db, "F01");
    expect((await mirrorSummaries(db)).get("F01")).toBeUndefined();

    // Без фактического выхода PnL — по цене выхода paper-сделки.
    const runId = await ensureRun(db);
    await store.insertTrade(trade("c", runId, "F01", new Date().toISOString()));
    const [fresh] = await listMirrorCandidates(
      db,
      new Date(Date.now() - 60_000),
    );
    await claimMirror(db, fresh);
    await updateMirror(db, "c", {
      status: "protected",
      message: "ok",
      steps: [],
      entryPrice: 100,
      quantity: 2,
    });
    await store.closeTrade("c", {
      closedAt: new Date().toISOString(),
      exitPrice: 99,
      exitReason: "sl",
      fees: 0,
      pnl: -2,
      rMultiple: -1,
    });
    await updateMirror(db, "c", {
      status: "closed",
      message: "биржа",
      steps: [],
      closed: true,
    });
    expect((await mirrorSummaries(db)).get("F01")).toMatchObject({
      closed: 1,
      losses: 1,
      pnl: -2,
    });
  });

  it("pnls — закрытые сделки в порядке закрытия; без цены выхода сделка в closed, но не в pnls", async () => {
    const store = await setup();
    const runId = await ensureRun(db);
    await store.insertTrade(trade("c", runId, "F01"));
    // a: +5 (закрыта позже), old: −2 (закрыта раньше), c: без цены выхода у обеих сторон.
    const closeMirror = async (
      c: MirrorCandidate,
      exitPrice: number | null,
      closedAt: string,
    ) => {
      await claimMirror(db, c);
      await updateMirror(db, c.tradeId, {
        status: "closed",
        message: "ok",
        steps: [],
        entryPrice: 100,
        quantity: 1,
        exitPrice,
        closed: true,
      });
      await db
        .update(demoMirrorOrdersTable)
        .set({ closedAt: new Date(closedAt) })
        .where(eq(demoMirrorOrdersTable.tradeId, c.tradeId));
    };
    const candidate = (tradeId: string): MirrorCandidate => ({
      tradeId,
      experimentId: "F01",
      market: "usdm",
      symbol: "ETHUSDT",
      direction: "long",
      openedAt: "2026-10-11T11:55:00.000Z",
      entryPrice: 100,
      quantity: 1,
      stop: 95,
      takeProfit: 110,
    });
    await closeMirror(candidate("a"), 105, "2026-10-11T13:00:00.000Z");
    await closeMirror(candidate("old"), 98, "2026-10-11T12:00:00.000Z");
    await closeMirror(candidate("c"), null, "2026-10-11T12:30:00.000Z");
    const s = (await mirrorSummaries(db)).get("F01");
    expect(s?.closed).toBe(3);
    expect(s?.pnls).toEqual([-2, 5]); // по времени закрытия
    expect(s?.pnl).toBe(3);
  });
});

describe("data-fix drizzle/0005 (spec 0012, AC2)", () => {
  it("отказы «нет в Binance Demo Trading» переносятся в пропуски, прочие отказы остаются", async () => {
    await setup();
    await setExperimentDemoMirror(db, "F01", true);
    await setExperimentDemoMirror(db, "F02", true);
    const [a, b] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, a);
    await claimMirror(db, b);
    await updateMirror(db, "a", {
      status: "rejected",
      message: "ETHUSDT нет в Binance Demo Trading (Futures).",
      steps: [],
    });
    await updateMirror(db, "b", {
      status: "rejected",
      message: "Биржа отклонила вход — позиция не открыта.",
      steps: [],
    });
    const fix = readFileSync(
      "drizzle/0005_mirror_missing_symbols_skipped.sql",
      "utf8",
    );
    await db.execute(sql.raw(fix));
    await db.execute(sql.raw(fix));
    const statuses = await mirrorStatuses(db, ["a", "b"]);
    expect(statuses.get("a")).toEqual({
      status: "skipped",
      message: "ETHUSDT: нет на демо-фьючерсах.",
    });
    expect(statuses.get("b")?.status).toBe("rejected");
  });
});

describe("protect_refs", () => {
  it("фьючерсы 2b (ссылки без legs: «quantity» — ноги с closePosition) — legacy: монета занята", async () => {
    await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    const refs2b = {
      market: "usdm" as const,
      entryOrderId: 1,
      stop: { algoId: 21, clientAlgoId: "bd1-S" },
      takeProfit: { algoId: 22, clientAlgoId: "bd1-T" },
    };
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      quantity: 0.5,
      protectRefs: refs2b,
    });
    expect((await activeMirrors(db))[0]?.hasRefs).toBe(false);
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      protectRefs: { ...refs2b, legs: "quantity" },
    });
    expect((await activeMirrors(db))[0]?.hasRefs).toBe(true);
  });

  it("спот со своими ссылками — не legacy (метка legs только у фьючерсов)", async () => {
    await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    await db.execute(
      sql.raw(
        "update demo_mirror_orders set market = 'spot' where trade_id = 'a'",
      ),
    );
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      quantity: 40,
      protectRefs: {
        market: "spot",
        orderListId: 7,
        netQuantity: 39.96,
        stop: { orderId: 71, clientOrderId: "bd1-S" },
        takeProfit: { orderId: 72, clientOrderId: "bd1-T" },
      },
    });
    expect(await activeMirrors(db)).toMatchObject([
      { market: "spot", hasRefs: true },
    ]);
  });

  it("своя нога сработала: строка закрыта биржей сразу, с ценой выхода; paper-сделка ещё открыта", async () => {
    await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    const protectRefs = {
      market: "usdm" as const,
      entryOrderId: 1,
      stop: { algoId: 21, clientAlgoId: "bd1-S" },
      takeProfit: { algoId: 22, clientAlgoId: "bd1-T" },
    };
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      entryPrice: 100,
      quantity: 0.5,
      protectRefs,
    });
    expect(await listOpenMirrorLegs(db)).toEqual([
      { tradeId: "a", symbol: "ETHUSDT", status: "protected", protectRefs },
    ]);
    expect(
      await markMirrorClosedByExchange(db, "a", {
        message: "Позиция закрыта биржей",
        steps: [],
        exitPrice: 104,
      }),
    ).toBe(true);
    // Повтор и захват на закрытие — уже не трогают закрытую строку.
    expect(
      await markMirrorClosedByExchange(db, "a", {
        message: "x",
        steps: [],
        exitPrice: 1,
      }),
    ).toBe(false);
    expect(await listOpenMirrorLegs(db)).toEqual([]);
    expect(await activeMirrors(db)).toEqual([]);
    // Демо-PnL — по фактической цене выхода, хотя paper-сделка не закрыта.
    expect((await mirrorSummaries(db)).get("F01")).toMatchObject({
      closed: 1,
      wins: 1,
      pnl: 2,
    });
  });

  it("старые строки без ссылок и битый jsonb — null (закрытие по-старому)", async () => {
    const store = await setup();
    await setExperimentDemoMirror(db, "F01", true);
    const [c] = await listMirrorCandidates(db, SINCE);
    await claimMirror(db, c);
    await updateMirror(db, "a", {
      status: "protected",
      message: "ok",
      steps: [],
      quantity: 0.5,
    });
    // Открытая строка до PR 2b (без protect_refs) — монета занята для новых зеркал (planMirror).
    expect(await activeMirrors(db)).toEqual([
      {
        market: "usdm",
        symbol: "ETHUSDT",
        direction: "long",
        hasRefs: false,
      },
    ]);
    await db.execute(
      sql`update demo_mirror_orders set protect_refs = '{"market":"spot"}'::jsonb where trade_id = 'a'`,
    );
    await store.closeTrade("a", {
      closedAt: "2026-10-11T12:30:00.000Z",
      exitPrice: 104,
      exitReason: "sl",
      fees: 0.1,
      pnl: 1.9,
      rMultiple: 0.4,
    });
    expect(await claimMirrorToClose(db, "a")).toMatchObject({
      tradeId: "a",
      protectRefs: null,
    });
  });
});

describe("демо-сброс группы (spec 0038)", () => {
  /** F01 (usdm) и S01 (spot) с открытыми зеркалами; F02 (usdm) без зеркала. */
  async function groups() {
    await seedExperiments(db, [
      exp("F01"),
      exp("F02"),
      { ...exp("S01"), market: "spot" },
    ]);
    const runId = await ensureRun(db);
    const store = createDbExperimentStore(db);
    await store.insertTrade(trade("f", runId, "F01"));
    await store.insertTrade({ ...trade("s", runId, "S01"), market: "spot" });
    await setExperimentDemoMirror(db, "F01", true);
    await setExperimentDemoMirror(db, "S01", true);
    for (const c of await listMirrorCandidates(db, SINCE)) {
      await claimMirror(db, c);
      await updateMirror(db, c.tradeId, {
        status: "protected",
        message: "ok",
        steps: [],
        entryPrice: 100,
        quantity: 0.5,
      });
    }
  }

  const demoResetAt = async () =>
    new Map(
      (
        await db
          .select({ id: experimentsTable.id, at: experimentsTable.demoResetAt })
          .from(experimentsTable)
      ).map((r) => [r.id, r.at]),
    );

  const ids = (list: { tradeId: string }[]) =>
    list.map((m) => m.tradeId).sort();

  it("группа: захватывает позиции и отмечает сброс только у экспериментов группы", async () => {
    await groups();
    expect(ids(await claimOpenMirrors(db, { market: "usdm" }))).toEqual(["f"]);
    expect(await markDemoReset(db, { market: "usdm" })).toBe(2);
    const at = await demoResetAt();
    expect(at.get("F01")).not.toBeNull();
    expect(at.get("F02")).not.toBeNull();
    expect(at.get("S01")).toBeNull();
    // Спот не тронут: его позиция всё ещё открыта.
    expect(ids(await claimOpenMirrors(db, { market: "spot" }))).toEqual(["s"]);
  });

  it("регрессия AC9: null — все эксперименты и все позиции, как раньше", async () => {
    await groups();
    expect(ids(await claimOpenMirrors(db, null))).toEqual(["f", "s"]);
    expect(await markDemoReset(db, null)).toBe(3);
    expect([...(await demoResetAt()).values()].every((v) => v !== null)).toBe(
      true,
    );
  });

  it("один эксперимент (id) — только он", async () => {
    await groups();
    expect(ids(await claimOpenMirrors(db, "S01"))).toEqual(["s"]);
    expect(await markDemoReset(db, "S01")).toBe(1);
    const at = await demoResetAt();
    expect(at.get("S01")).not.toBeNull();
    expect(at.get("F01")).toBeNull();
  });
});
