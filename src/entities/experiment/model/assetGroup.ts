import type { Experiment } from "@binance-dashboard/trading-core";

// Группы активов — AG (Asset Group), решение пользователя 2026-10-15 (spec 0016): кошельки Binance
// со своими инструментами. В коде и БД market остаётся spot/futures; COIN-M появится задачей D.

export type Market = Experiment["market"];

export interface AssetGroup {
  /** Код из глоссария: SPOT, FT:USDM, FT:COINM. */
  code: string;
  label: string;
  description: string;
}

export const ASSET_GROUPS: Record<Market, AssetGroup> = {
  spot: {
    code: "SPOT",
    label: "Spot",
    description:
      "Спотовый рынок: покупка и продажа монет за USDT, только лонг.",
  },
  futures: {
    code: "FT:USDM",
    label: "USDⓈ-M",
    description:
      "Бессрочные фьючерсы с маржой в стейблкоинах (USDT/USDC): лонг и шорт, плечо 1.",
  },
};

/** Описание термина «Группа активов» — то же, что в docs/ai/glossary.md (тест glossary.test.ts). */
export const ASSET_GROUP_DESCRIPTION =
  "Asset Group — кошелёк Binance со своим набором инструментов и своим балансом: Spot, USDⓈ-M, COIN-M. У каждого эксперимента одна группа; статистика, бюджеты и сбросы считаются по группам.";

export const assetGroupOf = (market: Market): AssetGroup =>
  ASSET_GROUPS[market];
