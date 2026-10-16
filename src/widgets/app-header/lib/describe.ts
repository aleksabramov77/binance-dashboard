import type {
  AccountBalances,
  WalletBalance,
} from "@/entities/account-balance";
import type { Market, MarketBudget } from "@/entities/experiment";
import { formatDateTime, formatUsd } from "@/shared/lib";

// Тексты чипов и поповера «Счета» (spec 0038): Paper — бюджеты лаборатории, Demo — остатки демо-счёта Binance,
// Real — торговый субсчёт по пульсу воркера реального счёта (spec 0047).

export const REAL_LABEL =
  "R — реальный счёт: торговый субсчёт Binance по пульсу воркера, $";

export const signedUsd = (v: number) => `${v > 0 ? "+" : ""}${formatUsd(v)}`;

export const signedPct = (v: number) =>
  `${v > 0 ? "+" : ""}${(v * 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/** Остаток кошелька для ячейки: «—» без числа, «…» пока грузится. */
export function walletText(w: WalletBalance | undefined): string {
  if (!w) return "…";
  return w.usd === null ? "—" : formatUsd(w.usd);
}

/** Подсказка к остатку: причина или оговорка, у остатка из пульса — «пульс <время>». */
export function walletHint(w: WalletBalance | undefined): string | null {
  if (!w) return null;
  const pulse = w.at ? `пульс ${formatDateTime(w.at)}` : null;
  return [w.hint, pulse].filter(Boolean).join(", ") || null;
}

/** Строки подсказки Paper группы — как в прежней шапке (MarketBudgets): старт, изменение, PnL, комиссии, позиции. */
export function paperLines(b: MarketBudget): string[] {
  return [
    `Старт учёта: ${formatUsd(b.initial)}`,
    `Изменение: ${signedUsd(b.change)} (${signedPct(b.changePct)})`,
    `Реализованный PnL (после комиссий): ${signedUsd(b.realized)}`,
    `Комиссии закрытых сделок: ${formatUsd(b.fees)}`,
    b.unrealized === null
      ? `Открытых позиций: ${b.openTrades} — нет цен, в equity не учтены`
      : `Открытых позиций: ${b.openTrades}, нереализованный PnL: ${signedUsd(b.unrealized)}`,
  ];
}

const walletLine = (
  prefix: string,
  w: WalletBalance | undefined,
  error: string | null,
) => {
  if (error) return `${prefix}: — (${error})`;
  if (!w) return `${prefix}: загрузка…`;
  const value = walletText(w);
  const hint = walletHint(w);
  return hint ? `${prefix}: ${value} (${hint})` : `${prefix}: ${value}`;
};

/** Подсказка чипа группы (AC1): что такое Paper, D и R, и их значения с причинами «—». */
export function chipTitle(input: {
  code: string;
  label: string;
  paper: MarketBudget | undefined;
  paperError: string | null;
  demo: WalletBalance | undefined;
  real: WalletBalance | undefined;
  balancesError: string | null;
}): string {
  const { paper } = input;
  return [
    `${input.code} — ${input.label}`,
    paper
      ? `Paper (симуляция лаборатории, все эксперименты группы): ${formatUsd(paper.equity)}`
      : `Paper (симуляция лаборатории): ${input.paperError ? `— (${input.paperError})` : "загрузка…"}`,
    ...(paper ? paperLines(paper).map((l) => `  ${l}`) : []),
    walletLine(
      "D — Demo-счёт Binance (demo.binance.com), equity в $",
      input.demo,
      input.balancesError,
    ),
    walletLine(REAL_LABEL, input.real, input.balancesError),
    "Нажмите — таблица по группам и ссылка на сбросы",
  ].join("\n");
}

export interface BalanceNote {
  account: "Demo" | "Real";
  /** Коды групп, к которым относится причина; все три — пусто (причина общая для счёта). */
  codes: string[];
  hint: string;
}

/**
 * Причины «—» и оговорки под таблицей поповера: на телефоне подсказки title не видны. Одинаковые причины счёта
 * склеиваются; если причина у всех групп — без перечисления групп.
 */
export function balanceNotes(
  balances: AccountBalances,
  groups: readonly { market: Market; code: string }[],
): BalanceNote[] {
  const notes: BalanceNote[] = [];
  for (const [account, wallets] of [
    ["Demo", balances.demo],
    ["Real", balances.real],
  ] as const) {
    const byHint = new Map<string, string[]>();
    for (const g of groups) {
      const hint = walletHint(wallets[g.market]);
      if (hint) byHint.set(hint, [...(byHint.get(hint) ?? []), g.code]);
    }
    for (const [hint, codes] of byHint)
      notes.push({
        account,
        codes: codes.length === groups.length ? [] : codes,
        hint,
      });
  }
  return notes;
}
