import { afterEach, describe, expect, it } from "vitest";
import type { Snapshot } from "@/entities/earn-offer";
import { createMemoryDb, type Db } from "@/shared/db/client.server";
import {
  countSnapshots,
  listRecentSnapshots,
  saveSnapshot,
} from "./snapshotStore";

const snap = (fetchedAt: string): Snapshot => ({ fetchedAt, offers: [] });

describe("snapshotStore (БД)", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(() => close?.());

  async function memory(): Promise<Db> {
    const m = await createMemoryDb();
    close = m.close;
    return m.db;
  }

  it("сохраняет снимки и отдаёт последние от старых к новым", async () => {
    const db = await memory();
    for (const at of [
      "2026-10-08T03:00:00.000Z",
      "2026-10-09T03:00:00.000Z",
      "2026-10-10T03:00:00.000Z",
    ])
      await saveSnapshot(snap(at), db);
    const recent = await listRecentSnapshots(2, db);
    expect(recent.map((s) => s.fetchedAt)).toEqual([
      "2026-10-09T03:00:00.000Z",
      "2026-10-10T03:00:00.000Z",
    ]);
    expect(await countSnapshots(db)).toBe(3);
  }, 30_000);

  it("повтор с тем же fetchedAt не дублирует снимок", async () => {
    const db = await memory();
    await saveSnapshot(snap("2026-10-10T03:00:00.000Z"), db);
    await saveSnapshot(snap("2026-10-10T03:00:00.000Z"), db);
    expect(await countSnapshots(db)).toBe(1);
  }, 30_000);

  it("пустая БД — нет снимков", async () => {
    const db = await memory();
    expect(await listRecentSnapshots(30, db)).toEqual([]);
    expect(await countSnapshots(db)).toBe(0);
  }, 30_000);
});
