import { describe, expect, it } from "vitest";
import type { Offer } from "@/entities/earn-offer";
import type {
  AdvancedCatalog,
  DualOffer,
  KindSummary,
  YieldProduct,
} from "@/entities/earn-product";
import type { RiskProfile } from "../config/profiles";
import { buildAllocation } from "./buildAllocation";
import { fillAllocation } from "./fillAllocation";

const offer = (o: Partial<Offer>): Offer => ({
  id: "USDT:flexible",
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
  ...o,
});

const simpleOffers: Offer[] = [
  offer({ id: "usdt-flex", maxApr: 0.06, baseApr: 0.06 }),
  offer({ id: "usdc-flex", asset: "USDC", maxApr: 0.04, baseApr: 0.04 }),
  offer({
    id: "btc-flex",
    asset: "BTC",
    stablecoin: false,
    priceUsd: 80_000,
    maxApr: 0.5,
    baseApr: 0.5,
  }),
  offer({
    id: "usdt-30",
    type: "locked",
    durationDays: 30,
    maxApr: 0.07,
    baseApr: 0.07,
  }),
  offer({
    id: "usdt-60",
    type: "locked",
    durationDays: 60,
    maxApr: 0.08,
    baseApr: 0.08,
  }),
  offer({
    id: "usdt-90",
    type: "locked",
    durationDays: 90,
    maxApr: 0.09,
    baseApr: 0.09,
  }),
  offer({
    id: "usdt-120",
    type: "locked",
    durationDays: 120,
    maxApr: 0.2,
    baseApr: 0.2,
    soldOut: true,
  }),
];

const yieldProduct = (p: Partial<YieldProduct>): YieldProduct => ({
  id: "rwusd",
  kind: "rwusd",
  name: "RWUSD",
  asset: "USDT",
  rewardAsset: null,
  apr: 0.036,
  lockDays: null,
  redemptionDays: 3,
  minPurchase: null,
  quotaLeft: null,
  soldOut: false,
  priceUsd: 1,
  ...p,
});

const dualOffer = (o: Partial<DualOffer>): DualOffer => ({
  id: "dual:btc-far",
  side: "buy-low",
  coin: "BTC",
  stable: "USDT",
  strikePrice: 74_000,
  apr: 0.2,
  durationDays: 7,
  settleAt: "2026-10-22T08:00:00.000Z",
  purchaseEndAt: "2026-10-21T08:00:00.000Z",
  minAmount: 10,
  maxAmount: 1_000_000,
  canPurchase: true,
  price: 80_000,
  ...o,
});

const catalog: AdvancedCatalog = {
  status: "ok",
  fetchedAt: "2026-10-15T00:00:00.000Z",
  warnings: [],
  yields: [
    yieldProduct({}),
    yieldProduct({ id: "bfusd", kind: "bfusd", name: "BFUSD", apr: 0.013 }),
    yieldProduct({
      id: "eth-staking",
      kind: "eth-staking",
      name: "ETH Staking",
      asset: "ETH",
      apr: 0.022,
      priceUsd: 3_000,
    }),
    yieldProduct({
      id: "onchain:Plasma-USDT-90D",
      kind: "onchain",
      name: "Plasma-USDT-90D",
      apr: 0.026,
    }),
    yieldProduct({
      id: "onchain:Plasma-USDT-7D",
      kind: "onchain",
      name: "Plasma-USDT-7D",
      apr: 0.023,
    }),
    yieldProduct({
      id: "onchain:Solv-90d",
      kind: "onchain",
      name: "Solv-90d",
      asset: "BTC",
      apr: 0.004,
      priceUsd: 80_000,
    }),
  ],
  dual: [
    dualOffer({}),
    dualOffer({ id: "dual:btc-near", strikePrice: 79_000, apr: 2 }),
    dualOffer({ id: "dual:btc-long", durationDays: 30, apr: 0.9 }),
    dualOffer({
      id: "dual:btc-sell",
      side: "sell-high",
      strikePrice: 90_000,
      apr: 0.5,
    }),
    dualOffer({
      id: "dual:eth",
      coin: "ETH",
      price: 3_000,
      strikePrice: 2_700,
      apr: 0.15,
    }),
    dualOffer({
      id: "dual:sol",
      coin: "SOL",
      price: 100,
      strikePrice: 90,
      apr: 0.1,
    }),
  ],
};

const summary: KindSummary[] = [
  {
    kind: "smart-arbitrage",
    asset: "USDT",
    minApr: 0.05,
    maxApr: 0.1,
    lowRisk: false,
    soldOut: false,
  },
  {
    kind: "rwusd",
    asset: "USDT",
    minApr: 0.036,
    maxApr: 0.036,
    lowRisk: false,
    soldOut: false,
  },
];

const bucket = (plan: ReturnType<typeof fillAllocation>, id: string) =>
  plan.buckets.find((b) => b.id === id);

describe("калькулятор: продукты в корзинах", () => {
  it("Flexible — только стейблы, не больше 25 % суммы в один продукт", () => {
    const plan = fillAllocation(
      buildAllocation(10_000, "conservative"),
      {
        simpleOffers,
        catalog,
        summary,
      },
      "conservative",
    );
    const flex = bucket(plan, "simple-flexible");
    expect(flex?.picks.map((p) => [p.id, p.amountUsd])).toEqual([
      ["usdt-flex", 2_500],
      ["usdc-flex", 2_500],
    ]);
    expect(flex?.unplacedUsd).toBe(1_000);
    expect(flex?.gap).toBe("no-products");
  });

  it("Locked — лестницей сроков 30/60/90, распроданные пропускаются", () => {
    const plan = fillAllocation(
      buildAllocation(9_000, "moderate"),
      {
        simpleOffers,
        catalog,
        summary,
      },
      "moderate",
    );
    const locked = bucket(plan, "simple-locked");
    expect(locked?.picks.map((p) => p.id)).toEqual([
      "usdt-30",
      "usdt-60",
      "usdt-90",
    ]);
    expect(locked?.picks.every((p) => Math.abs(p.amountUsd - 750) < 1e-9)).toBe(
      true,
    );
  });

  it("Dual — только Buy Low дальше 5 % от цены и до 14 дней, лучшее по монете, по 10 % суммы", () => {
    const plan = fillAllocation(
      buildAllocation(10_000, "aggressive"),
      {
        simpleOffers,
        catalog,
        summary,
      },
      "aggressive",
    );
    const dual = bucket(plan, "dual");
    expect(dual?.picks.map((p) => [p.id, p.amountUsd])).toEqual([
      ["dual:btc-far", 1_000],
      ["dual:eth", 1_000],
    ]);
  });

  it("DeFi — стейблы первыми, один продукт на протокол, не больше 10 % в протокол", () => {
    const plan = fillAllocation(
      buildAllocation(10_000, "aggressive"),
      {
        simpleOffers,
        catalog,
        summary,
      },
      "aggressive",
    );
    expect(
      bucket(plan, "onchain")?.picks.map((p) => [p.id, p.amountUsd]),
    ).toEqual([["onchain:Plasma-USDT-90D", 1_000]]);
  });

  it("без ключа — корзины каталога «нужен ключ», сумма в «не размещено», доход — по сводке", () => {
    const plan = fillAllocation(
      buildAllocation(10_000, "conservative"),
      {
        simpleOffers,
        catalog: { status: "not-configured", hosting: "local" },
        summary,
      },
      "conservative",
    );
    const stable = bucket(plan, "stable-yield");
    expect(stable).toMatchObject({
      gap: "needs-key",
      unplacedUsd: 1_500,
      estimated: true,
    });
    expect(stable?.expectedIncomeUsd).toBeCloseTo(1_500 * 0.036, 6);
    expect(plan.unfilledUsd).toBeCloseTo(1_000 + 1_500, 6);
  });

  it("без снимка Simple Earn и без сводки — корзины Simple пустые, доход 0", () => {
    const plan = fillAllocation(
      buildAllocation(1_000, "conservative"),
      {
        simpleOffers: null,
        catalog: null,
        summary: null,
      },
      "conservative",
    );
    expect(bucket(plan, "simple-flexible")).toMatchObject({
      gap: "no-snapshot",
      unplacedUsd: 600,
      expectedIncomeUsd: 0,
    });
    expect(bucket(plan, "stable-yield")?.gap).toBe("catalog-unavailable");
    expect(plan.unfilledUsd).toBeCloseTo(1_000, 6);
  });

  it("Smart Arbitrage — только вручную; ожидаемый доход складывается из продуктов", () => {
    const plan = fillAllocation(
      buildAllocation(10_000, "aggressive"),
      {
        simpleOffers,
        catalog,
        summary,
      },
      "aggressive",
    );
    const arb = bucket(plan, "smart-arbitrage");
    expect(arb).toMatchObject({
      gap: "manual",
      unplacedUsd: 500,
      estimated: true,
    });
    expect(plan.expectedIncomeUsd).toBeCloseTo(
      plan.buckets.reduce((s, b) => s + b.expectedIncomeUsd, 0),
      6,
    );
    expect(plan.amountUsd).toBeCloseTo(10_000, 6);
  });

  const unprotectedUsd = (p: ReturnType<typeof fillAllocation>) =>
    p.buckets
      .flatMap((b) => b.picks)
      .filter((pick) => /^(dual:|onchain:|bfusd)/.test(pick.id))
      .reduce((s, pick) => s + pick.amountUsd, 0) +
    (bucket(p, "smart-arbitrage")?.amountUsd ?? 0);
  const planFor = (amount: number, profile: RiskProfile) =>
    fillAllocation(
      buildAllocation(amount, profile),
      { simpleOffers, catalog, summary },
      profile,
    );

  it("консервативный — 0 $ в незащищённых: RWUSD/BFUSD-корзина целиком в RWUSD", () => {
    const plan = planFor(10_000, "conservative");
    expect(unprotectedUsd(plan)).toBe(0);
    expect(
      bucket(plan, "stable-yield")?.picks.map((p) => [p.id, p.amountUsd]),
    ).toEqual([["rwusd", 1_500]]);
  });

  it("агрессивный — незащищённые вместе с BFUSD не больше 35 % суммы", () => {
    const plan = planFor(10_000, "aggressive");
    expect(unprotectedUsd(plan)).toBeLessThanOrEqual(3_500 + 1e-6);
    // Dual, DeFi и Smart Arbitrage уже занимают весь лимит — BFUSD не достаётся, его доля уходит в RWUSD.
    expect(
      bucket(plan, "stable-yield")?.picks.map((p) => [p.id, p.amountUsd]),
    ).toEqual([["rwusd", 1_000]]);
  });

  it("умеренный — BFUSD получает только остаток лимита 15 %, излишек — в RWUSD", () => {
    const plan = planFor(10_000, "moderate");
    const stable = bucket(plan, "stable-yield");
    expect(stable?.picks.map((p) => [p.id, p.amountUsd])).toEqual([
      ["bfusd", 500],
      ["rwusd", 1_000],
    ]);
    expect(unprotectedUsd(plan)).toBeCloseTo(1_500, 6);
  });

  it("сумма меньше минимума продукта — в «не размещено» с причиной", () => {
    const small: AdvancedCatalog = {
      ...catalog,
      yields: [
        yieldProduct({
          id: "onchain:Plasma-USDT-90D",
          kind: "onchain",
          name: "Plasma-USDT-90D",
          apr: 0.026,
          minPurchase: 100,
        }),
      ],
      dual: [
        dualOffer({ minAmount: 60 }),
        dualOffer({
          id: "dual:eth",
          coin: "ETH",
          price: 3_000,
          strikePrice: 2_700,
          apr: 0.15,
          minAmount: 60,
        }),
      ],
    };
    const plan = fillAllocation(
      buildAllocation(500, "aggressive"),
      { simpleOffers, catalog: small, summary },
      "aggressive",
    );
    expect(bucket(plan, "onchain")).toMatchObject({
      picks: [],
      unplacedUsd: 50,
      gap: "below-minimum",
    });
    // Dual 100 $ на две монеты — по 50 $ при минимуме 60: обе выбывают.
    expect(bucket(plan, "dual")).toMatchObject({
      picks: [],
      gap: "below-minimum",
    });
  });

  it("Locked: занятый ближайший срок не обнуляет ступень — берётся следующий по близости", () => {
    const offers = [
      offer({
        id: "usdt-30",
        type: "locked",
        durationDays: 30,
        maxApr: 0.07,
        baseApr: 0.07,
      }),
      offer({
        id: "usdt-120",
        type: "locked",
        durationDays: 120,
        maxApr: 0.09,
        baseApr: 0.09,
      }),
      offer({
        id: "usdc-60",
        asset: "USDC",
        type: "locked",
        durationDays: 60,
        maxApr: 0.2,
        baseApr: 0.2,
        minPurchase: 10_000,
      }),
    ];
    const plan = fillAllocation(
      buildAllocation(9_000, "moderate"),
      { simpleOffers: offers, catalog, summary },
      "moderate",
    );
    // 60 дн. (USDC) ниже минимума и отсеян до поиска срока; ступень 60 получает 120 дн., на 90 продуктов не осталось.
    expect(bucket(plan, "simple-locked")?.picks.map((p) => p.label)).toEqual([
      "USDT Locked 30 дн.",
      "USDT Locked 120 дн.",
    ]);
    expect(bucket(plan, "simple-locked")?.gap).toBe("below-minimum");
  });
});
