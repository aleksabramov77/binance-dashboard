import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import type { LiveState } from "../model/heartbeat";
import { loadLiveState, saveLiveState } from "./liveStateDb";

let db: Db;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ db, close } = await createMemoryDb());
}, 60_000);
afterAll(() => close());

const state: LiveState = {
  heartbeat: {
    version: "test",
    handshake: false,
    sentAt: "2026-10-16T12:00:00.000Z",
    fixture: "ok",
    verdict: "ok",
    reasons: [],
    warnings: [],
    restrictions: { flags: null, checkedAt: null },
    uid: { status: "different", note: null },
    spot: { usdtFree: 50, usdtLocked: 0, equityUsd: 61.5, unpriced: [] },
    usdm: { walletBalance: 40, availableBalance: 40, unrealizedProfit: 0 },
    balancesNote: null,
    error: null,
  },
  receivedAt: "2026-10-16T12:00:01.000Z",
  status: "ok",
  statusSince: "2026-10-16T12:00:01.000Z",
  silentSince: null,
};

describe("live_worker_state (миграция на SQLite)", () => {
  it("пульса не было — null; запись и перезапись одной строки", async () => {
    expect(await loadLiveState(db)).toBeNull();
    await saveLiveState(db, state);
    expect(await loadLiveState(db)).toEqual(state);
    const next = {
      ...state,
      status: "blocked" as const,
      silentSince: "2026-10-16T12:10:00.000Z",
    };
    await saveLiveState(db, next);
    expect(await loadLiveState(db)).toEqual(next);
  });
});
