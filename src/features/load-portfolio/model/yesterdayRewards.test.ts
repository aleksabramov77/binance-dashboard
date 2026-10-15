import { describe, expect, it } from "vitest";
import {
  sumYesterdayRewardsUsd,
  yesterdayUsdFor,
  yesterdayUtcRange,
} from "./yesterdayRewards";

describe("yesterdayUtcRange", () => {
  it("вчерашние сутки по UTC: от полуночи до полуночи", () => {
    expect(yesterdayUtcRange(new Date("2026-10-15T09:30:00Z"))).toEqual({
      startTime: Date.parse("2026-10-14T00:00:00Z"),
      endTime: Date.parse("2026-10-15T00:00:00Z"),
    });
  });

  it("сразу после полуночи UTC — уже новые «вчера», независимо от часового пояса сервера", () => {
    expect(yesterdayUtcRange(new Date("2026-10-15T00:00:00Z"))).toEqual({
      startTime: Date.parse("2026-10-14T00:00:00Z"),
      endTime: Date.parse("2026-10-15T00:00:00Z"),
    });
    expect(
      yesterdayUtcRange(new Date("2026-10-14T23:59:59.999Z")).startTime,
    ).toBe(Date.parse("2026-10-13T00:00:00Z"));
  });

  it("через границу месяца и года", () => {
    expect(yesterdayUtcRange(new Date("2027-01-01T05:00:00Z"))).toEqual({
      startTime: Date.parse("2026-12-31T00:00:00Z"),
      endTime: Date.parse("2027-01-01T00:00:00Z"),
    });
  });
});

const prices: Record<string, number> = { USDT: 1, BNB: 600, BTC: 100_000 };
const price = (asset: string) => prices[asset] ?? null;
const flex = (
  asset: string,
  rewards: number,
  type: string,
  productId: string | null = `${asset}001`,
) => ({ asset, rewards, type, productId, time: 0 });

describe("sumYesterdayRewardsUsd + yesterdayUsdFor", () => {
  const usdt = {
    asset: "USDT",
    place: "flexible" as const,
    productId: "USDT001",
    positionId: null,
  };

  it("Flexible: складывает REALTIME и BONUS по продукту, REWARDS не учитывает", () => {
    const sums = sumYesterdayRewardsUsd(
      {
        flexible: [
          flex("USDT", 0.07, "REALTIME"),
          flex("USDT", 0.05, "BONUS"),
          flex("USDT", 0.05, "REWARDS"),
          flex("BTC", 0.00000006, "REALTIME"),
        ],
        locked: [],
      },
      price,
    );
    expect(yesterdayUsdFor(usdt, sums)).toBeCloseTo(0.12);
    expect(
      yesterdayUsdFor({ ...usdt, asset: "BTC", productId: "BTC001" }, sums),
    ).toBeCloseTo(0.006);
  });

  it("награда в другой монете — по цене своей монеты", () => {
    const sums = sumYesterdayRewardsUsd(
      { flexible: [flex("BNB", 0.001, "BONUS", "USDT001")], locked: [] },
      price,
    );
    expect(yesterdayUsdFor(usdt, sums)).toBeCloseTo(0.6);
  });

  it("строка без id продукта сопоставляется по монете", () => {
    const sums = sumYesterdayRewardsUsd(
      {
        flexible: [
          flex("USDT", 0.07, "REALTIME"),
          flex("USDT", 0.03, "BONUS", null),
        ],
        locked: [],
      },
      price,
    );
    expect(yesterdayUsdFor(usdt, sums)).toBeCloseTo(0.1);
  });

  it("Locked: сумма по позиции, позиции не смешиваются", () => {
    const sums = sumYesterdayRewardsUsd(
      {
        flexible: [],
        locked: [
          { positionId: "1", asset: "BNB", amount: 0.001, time: 0 },
          { positionId: "1", asset: "BNB", amount: 0.002, time: 0 },
          { positionId: "2", asset: "BNB", amount: 0.01, time: 0 },
        ],
      },
      price,
    );
    const locked = {
      asset: "BNB",
      place: "locked" as const,
      productId: "BNB*30",
    };
    expect(yesterdayUsdFor({ ...locked, positionId: "1" }, sums)).toBeCloseTo(
      1.8,
    );
    expect(yesterdayUsdFor({ ...locked, positionId: "2" }, sums)).toBeCloseTo(
      6,
    );
  });

  it("Earn-позиция без начислений — 0, Spot и Funding — null", () => {
    const sums = sumYesterdayRewardsUsd({ flexible: [], locked: [] }, price);
    expect(yesterdayUsdFor(usdt, sums)).toBe(0);
    expect(
      yesterdayUsdFor(
        { asset: "BNB", place: "locked", productId: "x", positionId: "9" },
        sums,
      ),
    ).toBe(0);
    expect(yesterdayUsdFor({ ...usdt, place: "spot" }, sums)).toBeNull();
    expect(yesterdayUsdFor({ ...usdt, place: "funding" }, sums)).toBeNull();
  });

  it("история не загрузилась — null у Earn-позиций", () => {
    expect(yesterdayUsdFor(usdt, null)).toBeNull();
    expect(
      yesterdayUsdFor(
        { asset: "BNB", place: "locked", productId: "x", positionId: "9" },
        null,
      ),
    ).toBeNull();
  });

  it("цена награды неизвестна — null, а не заниженная сумма", () => {
    const sums = sumYesterdayRewardsUsd(
      {
        flexible: [
          flex("USDT", 0.07, "REALTIME"),
          flex("XYZ", 5, "BONUS", "USDT001"),
        ],
        locked: [],
      },
      price,
    );
    expect(yesterdayUsdFor(usdt, sums)).toBeNull();
  });
});
