import type { EarnKind } from "@/entities/earn-product";
import {
  DUAL_MAX_DAYS,
  DUAL_MIN_DISTANCE,
  LOCK_LADDER,
  MAX_SHARE_PER_PROTOCOL,
  MAX_UNPROTECTED_SHARE,
  sharePercent,
} from "./rules";

export const RISK_PROFILES = [
  "conservative",
  "moderate",
  "aggressive",
] as const;
export type RiskProfile = (typeof RISK_PROFILES)[number];

export const PROFILE_LABELS: Record<RiskProfile, string> = {
  conservative: "Консервативный",
  moderate: "Умеренный",
  aggressive: "Агрессивный",
};

export const PROFILE_DESCRIPTIONS: Record<RiskProfile, string> = {
  conservative:
    "Главное — не потерять. Только продукты, где возвращается то же количество монет, и только стейблкоины (BFUSD не берём). Доход скромный.",
  moderate: `Основа — надёжные продукты, небольшая часть — в стейкинг и Dual ради дохода повыше. Без защиты капитала — не больше ${sharePercent(MAX_UNPROTECTED_SHARE.moderate)} суммы.`,
  aggressive: `Готовы рискнуть до ${sharePercent(MAX_UNPROTECTED_SHARE.aggressive)} суммы ради заметно большего дохода. Даже здесь большая часть — в надёжных продуктах.`,
};

/** Корзины калькулятора: несколько видов Earn с одинаковой ролью в портфеле. */
export const BUCKETS = [
  "simple-flexible",
  "simple-locked",
  "stable-yield",
  "staking",
  "dual",
  "onchain",
  "smart-arbitrage",
] as const;
export type BucketId = (typeof BUCKETS)[number];

export const BUCKET_KINDS: Record<BucketId, readonly EarnKind[]> = {
  "simple-flexible": ["simple-flexible"],
  "simple-locked": ["simple-locked"],
  "stable-yield": ["rwusd", "bfusd"],
  staking: ["eth-staking", "sol-staking"],
  dual: ["dual"],
  onchain: ["onchain"],
  "smart-arbitrage": ["smart-arbitrage"],
};

export const BUCKET_INFO: Record<BucketId, { title: string; why: string }> = {
  "simple-flexible": {
    title: "Simple Earn Flexible (стейблкоины)",
    why: "Резерв: деньги доступны сразу, количество монет не уменьшается. Сюда же — всё, что может понадобиться в ближайшие месяцы.",
  },
  "simple-locked": {
    title: "Simple Earn Locked (стейблкоины, лестница сроков)",
    why: `Ставка выше Flexible за заморозку. Разложено на сроки ${LOCK_LADDER.join("/")} дней, чтобы часть денег освобождалась регулярно.`,
  },
  "stable-yield": {
    title: "RWUSD / BFUSD",
    why: "Долларовый доход от облигаций (RWUSD) и стратегии Binance (BFUSD). Вывод занимает 1–3 дня. У BFUSD капитал не защищён — он идёт в лимит незащищённой части профиля (в консервативном — только RWUSD).",
  },
  staking: {
    title: "ETH / SOL Staking",
    why: "Доход в монетах сети. Требует купить ETH или SOL — значит, вы принимаете риск их курса.",
  },
  dual: {
    title: "Dual Investment (Buy Low)",
    why: `Высокая ставка за готовность купить монету дешевле текущей цены. Целевая цена — не ближе ${sharePercent(DUAL_MIN_DISTANCE)} от рынка, срок — до ${DUAL_MAX_DAYS} дней.`,
  },
  onchain: {
    title: "On-chain Yields (DeFi)",
    why: `Самый рискованный вид: деньги уходят во внешние протоколы. Не больше ${sharePercent(MAX_SHARE_PER_PROTOCOL)} в один протокол.`,
  },
  "smart-arbitrage": {
    title: "Smart Arbitrage",
    why: "Доход от ставки funding. API у Binance нет — выбирать вручную на сайте, сумма остаётся неразмещённой.",
  },
};

/**
 * Доли по профилям — стартовые константы spec 0019 (пользователь уточняет при приёмке).
 * Ликвидный резерв (MIN_LIQUID_RESERVE) входит во Flexible.
 */
export const PROFILE_TARGETS: Record<
  RiskProfile,
  Partial<Record<BucketId, number>>
> = {
  conservative: {
    "simple-flexible": 0.6,
    "simple-locked": 0.25,
    "stable-yield": 0.15,
  },
  moderate: {
    "simple-flexible": 0.35,
    "simple-locked": 0.25,
    "stable-yield": 0.15,
    staking: 0.15,
    dual: 0.1,
  },
  aggressive: {
    "simple-flexible": 0.2,
    "simple-locked": 0.15,
    "stable-yield": 0.1,
    staking: 0.2,
    dual: 0.2,
    onchain: 0.1,
    "smart-arbitrage": 0.05,
  },
};
