import { describe, expect, it } from "vitest";
import { diffSnapshots } from "./diff";
import type { Offer, Snapshot } from "./schema";

const offer = (patch: Partial<Offer>): Offer => ({
  id: "USDT001:flexible:0",
  asset: "USDT",
  type: "flexible",
  durationDays: 0,
  maxApr: 0.05,
  baseApr: 0.05,
  tiers: [],
  minPurchase: null,
  maxPerUser: null,
  soldOut: false,
  stablecoin: true,
  priceUsd: 1,
  ...patch,
});
const snap = (fetchedAt: string, offers: Offer[]): Snapshot => ({
  fetchedAt,
  offers,
});

describe("diffSnapshots", () => {
  it("находит новые, удалённые и заметно изменившиеся предложения", () => {
    const prev = snap("t1", [offer({}), offer({ id: "old", asset: "DAI" })]);
    const next = snap("t2", [
      offer({ maxApr: 0.08 }),
      offer({ id: "new", asset: "USDC" }),
    ]);
    const kinds = diffSnapshots(prev, next).map(
      (c) => `${c.kind}:${c.offer.id}`,
    );
    expect(kinds).toEqual([
      "apr:USDT001:flexible:0",
      "added:new",
      "removed:old",
    ]);
  });

  it("игнорирует мелкие колебания плавающей ставки", () => {
    const prev = snap("t1", [offer({})]);
    const next = snap("t2", [offer({ maxApr: 0.0505 })]);
    expect(diffSnapshots(prev, next)).toEqual([]);
  });

  it("сообщает о смене бонусных ступеней и распродаже", () => {
    const prev = snap("t1", [offer({})]);
    const next = snap("t2", [
      offer({ tiers: [{ from: 0, to: 1000, bonusApr: 0.03 }], soldOut: true }),
    ]);
    expect(diffSnapshots(prev, next).map((c) => c.kind)).toEqual([
      "tiers",
      "soldOut",
    ]);
  });
});
