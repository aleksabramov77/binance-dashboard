import {
  type Experiment,
  legacyMarketSchema,
  MARKET_KIND,
  type MarketKind,
} from "@binance-dashboard/trading-core";

// Группы активов — AG (Asset Group), решение пользователя 2026-10-15 (spec 0016): кошельки Binance
// со своими инструментами. Ключ в БД и URL — market (spot / usdm / coinm), код для людей — code (spec 0023).

export type Market = Experiment["market"];

export interface AssetGroup {
  /** Код из глоссария: SPOT, FT:USDM, FT:COINM. */
  code: string;
  label: string;
  description: string;
  /** Вид группы: фьючерсы — шорт, плечо, funding (то же, что MARKET_KIND ядра). */
  kind: MarketKind;
  /** Почему демо-зеркало группы недоступно; null — доступно. */
  demoMirrorBlocked: string | null;
}

/** Демо-зеркало COIN-M (demo-dapi) — отдельная задача после spec 0012 (spec 0023, AC7). */
export const COINM_MIRROR_BLOCKED = "Демо-зеркало COIN-M — позже";

/** Порядок ключей — порядок групп в шапке, фильтрах и сортировке по AG. */
export const ASSET_GROUPS: Record<Market, AssetGroup> = {
  spot: {
    code: "SPOT",
    label: "Spot",
    description:
      "Спотовый рынок: покупка и продажа монет за USDT, только лонг.",
    kind: MARKET_KIND.spot,
    demoMirrorBlocked: null,
  },
  usdm: {
    code: "FT:USDM",
    label: "USDⓈ-M",
    description:
      "Бессрочные фьючерсы с маржой в стейблкоинах (USDT/USDC): лонг и шорт, плечо 1.",
    kind: MARKET_KIND.usdm,
    demoMirrorBlocked: null,
  },
  coinm: {
    code: "FT:COINM",
    label: "COIN-M",
    description:
      "Бессрочные фьючерсы с маржой в монете (BTCUSD_PERP…), контракты по $100 (BTC) и $10: лонг и шорт, плечо 1; бюджет и PnL — в $.",
    kind: MARKET_KIND.coinm,
    demoMirrorBlocked: COINM_MIRROR_BLOCKED,
  },
};

/** Описание термина «Группа активов» — то же, что в docs/ai/glossary.md (тест glossary.test.ts). */
export const ASSET_GROUP_DESCRIPTION =
  "Asset Group — кошелёк Binance со своим набором инструментов и своим балансом: Spot, USDⓈ-M, COIN-M. У каждого эксперимента одна группа; статистика, бюджеты и сбросы считаются по группам.";

export const assetGroupOf = (market: Market): AssetGroup =>
  ASSET_GROUPS[market];

/** Значение фильтра группы из URL: старое `futures` — USDⓈ-M; мусор — null (фильтр «все»). */
export function parseMarketParam(value: string): Market | null {
  const parsed = legacyMarketSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Группы, которые демо-зеркало умеет повторять на Binance Demo (у них demoMirrorBlocked — null). */
export const DEMO_MIRROR_MARKETS = [
  "spot",
  "usdm",
] as const satisfies readonly Market[];
export type DemoMirrorMarket = (typeof DEMO_MIRROR_MARKETS)[number];
