import type { RiskProfile } from "./profiles";

/** Минимум суммы во Flexible-стейблах: забрать можно сразу. */
export const MIN_LIQUID_RESERVE = 0.1;
/** Не больше этой доли суммы в один продукт. */
export const MAX_SHARE_PER_PRODUCT = 0.25;
/** Не больше этой доли суммы в один DeFi-протокол. */
export const MAX_SHARE_PER_PROTOCOL = 0.1;
/** Не больше этой доли суммы в одно предложение Dual. */
export const MAX_SHARE_PER_DUAL_OFFER = 0.1;
/**
 * Потолок продуктов с незащищённым капиталом (виды с `principalProtected: false`: Dual, DeFi,
 * Smart Arbitrage, BFUSD) — доля всей суммы по профилю.
 */
export const MAX_UNPROTECTED_SHARE: Record<RiskProfile, number> = {
  conservative: 0,
  moderate: 0.15,
  aggressive: 0.35,
};
/** Сроки лестницы Locked, дней. */
export const LOCK_LADDER = [30, 60, 90] as const;
/** Dual: целевая цена не ближе этой доли к текущей. */
export const DUAL_MIN_DISTANCE = 0.05;
/** Dual: срок не дольше, дней. */
export const DUAL_MAX_DAYS = 14;
/** Dual: не больше стольких разных монет. */
export const DUAL_MAX_PICKS = 2;

/** Доля → «25 %» для текстов: числа в текстах берутся из констант, чтобы не разъезжались. */
export const sharePercent = (share: number) =>
  `${Number((share * 100).toFixed(1)).toLocaleString("ru-RU")} %`;

const ladder = LOCK_LADDER.join(", ").replace(/, (\d+)$/, " и $1");

export const DIVERSIFICATION_RULES: { title: string; text: string }[] = [
  {
    title: "Держите резерв",
    text: `Не меньше ${sharePercent(MIN_LIQUID_RESERVE)} — во Flexible на стейблкоинах. Эти деньги можно забрать в любой момент, если понадобятся или подвернётся выгодная возможность.`,
  },
  {
    title: `Не больше ${sharePercent(MAX_SHARE_PER_PRODUCT)} в один продукт`,
    text: "Даже самый надёжный продукт может закрыться, сменить ставку или упереться в лимит. Несколько продуктов — меньше зависимость от одного.",
  },
  {
    title: "Незащищённый капитал — малая доля",
    text: `Dual, DeFi, Smart Arbitrage и BFUSD могут вернуть меньше, чем вы вложили. Вместе — не больше ${sharePercent(MAX_UNPROTECTED_SHARE.conservative)} в консервативном профиле, ${sharePercent(MAX_UNPROTECTED_SHARE.moderate)} в умеренном и ${sharePercent(MAX_UNPROTECTED_SHARE.aggressive)} в агрессивном; одно предложение Dual или один DeFi-протокол — не больше ${sharePercent(Math.max(MAX_SHARE_PER_DUAL_OFFER, MAX_SHARE_PER_PROTOCOL))}.`,
  },
  {
    title: "Срочные вклады — лестницей",
    text: `Не кладите всё на один срок: разложите Locked на ${ladder} дней. Тогда часть денег освобождается регулярно, и не придётся выходить досрочно с потерей процентов.`,
  },
  {
    title: "Dual — только с монетой, которую готовы держать",
    text: `Buy Low — если вы и так хотите купить эту монету по целевой цене; Sell High — если готовы её продать. Цель — не ближе ${sharePercent(DUAL_MIN_DISTANCE)} от текущей цены, срок — до ${DUAL_MAX_DAYS} дней.`,
  },
  {
    title: `DeFi — не больше ${sharePercent(MAX_SHARE_PER_PROTOCOL)} в один протокол`,
    text: "Взлом или ошибка одного протокола не должны задеть больше небольшой части денег.",
  },
  {
    title: "Высокий APR — это плата за риск",
    text: "Сравнивайте ставку не только между продуктами, но и с Flexible: разница — это то, сколько вам платят за риск остаться не в той валюте или потерять часть.",
  },
  {
    title: "Не всё на одной бирже",
    text: "Все продукты Earn держатся на надёжности Binance. Часть капитала разумно хранить вне биржи — это вне дашборда, но помнить об этом стоит.",
  },
];
