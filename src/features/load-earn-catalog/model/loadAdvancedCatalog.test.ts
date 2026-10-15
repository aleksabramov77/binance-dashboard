import { describe, expect, it, vi } from "vitest";
import { BinanceApiError } from "@/shared/api/binance/account.server";
import { buildAdvancedCatalog, type CatalogDeps } from "./loadAdvancedCatalog";

const creds = { apiKey: "k", apiSecret: "s" };
const now = () => new Date("2026-10-15T00:00:00.000Z");

function deps(overrides: Partial<CatalogDeps> = {}): CatalogDeps {
  return {
    credentials: () => creds,
    hosting: () => "local",
    prices: async () => new Map([["BTCUSDT", 80_000]]),
    dual: async (_c, q) =>
      q.investCoin === "BTC" && q.exercisedCoin === "USDT"
        ? [
            {
              id: "1",
              investCoin: "BTC",
              exercisedCoin: "USDT",
              strikePrice: 81_000,
              duration: 1,
              settleDate: 0,
              purchaseEndTime: 0,
              canPurchase: true,
              apr: 2.5,
              minAmount: 0.0001,
              maxAmount: 1,
              optionType: "CALL",
            },
          ]
        : [],
    onchain: async () => [],
    softStaking: async () => [],
    stakingQuota: async () => ({ redeemPeriod: 4 }),
    stableQuota: async () => ({}),
    latestRate: async () => ({ annualPercentageRate: 0.03, time: 0 }),
    ...overrides,
  };
}

describe("загрузчик каталогов сложных продуктов", () => {
  it("без ключа — not-configured с хостингом, в Binance не ходит", async () => {
    const dual = vi.fn();
    expect(
      await buildAdvancedCatalog(
        deps({ credentials: () => null, hosting: () => "cloud", dual }),
        now,
      ),
    ).toEqual({ status: "not-configured", hosting: "cloud" });
    expect(dual).not.toHaveBeenCalled();
  });

  it("с ключом: Dual по 16 парам и пять доходных групп", async () => {
    const dual = vi.fn(deps().dual);
    const catalog = await buildAdvancedCatalog(deps({ dual }), now);
    expect(dual).toHaveBeenCalledTimes(16);
    expect(catalog).toMatchObject({
      status: "ok",
      fetchedAt: "2026-10-15T00:00:00.000Z",
      warnings: [],
    });
    if (catalog.status !== "ok") throw new Error("ожидался ok");
    expect(catalog.dual).toHaveLength(1);
    expect(catalog.yields.map((y) => y.kind)).toEqual([
      "eth-staking",
      "sol-staking",
      "rwusd",
      "bfusd",
    ]);
  });

  it("частичный сбой: упавшие группы и пары — в warnings, остальное видно", async () => {
    const catalog = await buildAdvancedCatalog(
      deps({
        stableQuota: async (_c, product) => {
          if (product === "bfusd")
            throw new BinanceApiError("Binance: нет аккаунта BFUSD (-1)");
          return {};
        },
        dual: async (_c, q) => {
          if (q.investCoin === "SOL") throw new Error("таймаут");
          return [];
        },
      }),
      now,
    );
    expect(catalog.status).toBe("ok");
    if (catalog.status !== "ok") return;
    expect(catalog.yields.map((y) => y.kind)).toEqual([
      "eth-staking",
      "sol-staking",
      "rwusd",
    ]);
    expect(catalog.warnings).toEqual([
      "Dual Investment: не загрузились SOL/USDT Sell High, SOL/USDC Sell High — таймаут",
      "BFUSD: Binance: нет аккаунта BFUSD (-1)",
    ]);
  });

  it("не загрузилось ничего (невалидный ключ) — error с текстом Binance", async () => {
    const fail = async () => {
      throw new BinanceApiError("Binance: API-key format invalid. (-2014)");
    };
    expect(
      await buildAdvancedCatalog(
        deps({
          dual: fail,
          onchain: fail,
          softStaking: fail,
          stakingQuota: fail,
          stableQuota: fail,
          latestRate: fail,
        }),
        now,
      ),
    ).toEqual({
      status: "error",
      message: "Binance: API-key format invalid. (-2014)",
    });
  });

  it("сбой цен не валит каталог: предупреждение и предложения без цены", async () => {
    const catalog = await buildAdvancedCatalog(
      deps({ prices: async () => Promise.reject(new Error("нет сети")) }),
      now,
    );
    if (catalog.status !== "ok") throw new Error("ожидался ok");
    expect(catalog.warnings).toEqual(["Цены монет: нет сети"]);
    expect(catalog.dual[0].price).toBeNull();
  });
});
