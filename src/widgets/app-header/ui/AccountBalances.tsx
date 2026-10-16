"use client";

import Link from "next/link";
import type * as React from "react";
import {
  type AccountBalances as Balances,
  useAccountBalances,
} from "@/entities/account-balance";
import {
  ASSET_GROUPS,
  MARKETS,
  type Market,
  type MarketBudget,
  useExperimentBudgets,
} from "@/entities/experiment";
import { cn, formatDateTime, formatUsd } from "@/shared/lib";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/Popover";
import {
  Table,
  TableBody,
  TableCell,
  TableFrame,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/Table";
import {
  balanceNotes,
  chipTitle,
  signedPct,
  signedUsd,
  walletHint,
  walletText,
} from "../lib/describe";

// Счета по группам активов в шапке (spec 0038): Paper — лаборатория, D — Binance Demo, R — Real (торговый субсчёт
// по пульсу воркера, spec 0047). Слой платформы,
// часть хедера: склеивает Лабораторию (бюджеты) и остатки Binance через их public API.

const GROUPS = MARKETS.map((market) => ({
  market,
  ...ASSET_GROUPS[market],
}));

const tone = (v: number) =>
  v > 0
    ? "text-positive"
    : v < 0
      ? "text-destructive"
      : "text-muted-foreground";

interface Data {
  budgets: Map<Market, MarketBudget> | null;
  budgetsError: string | null;
  balances: Balances | undefined;
  balancesError: string | null;
}

function useAccountsData(): Data {
  const budgets = useExperimentBudgets();
  const balances = useAccountBalances();
  return {
    budgets: budgets.data
      ? new Map(budgets.data.markets.map((b) => [b.market, b]))
      : null,
    budgetsError: budgets.error?.message ?? null,
    balances: balances.data,
    balancesError: balances.error?.message ?? null,
  };
}

/** Ячейка Demo/Real: число, «—» с причиной, «…» пока грузится. Оговорка при числе — звёздочкой. */
function WalletCell({
  data,
  account,
  market,
}: {
  data: Data;
  account: "demo" | "real";
  market: Market;
}) {
  if (data.balancesError) return <span title={data.balancesError}>—</span>;
  const w = data.balances?.[account][market];
  return (
    <span title={walletHint(w) ?? undefined}>
      {walletText(w)}
      {w?.hint && w.usd !== null && (
        <span className="text-muted-foreground">*</span>
      )}
    </span>
  );
}

function BalancesTable({ data }: { data: Data }) {
  const notes = data.balances ? balanceNotes(data.balances, GROUPS) : [];
  return (
    <div className="flex flex-col gap-3">
      <TableFrame>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead title="Группа активов (AG) — кошелёк Binance">
                AG
              </TableHead>
              <TableHead
                className="text-right"
                title="Paper — симуляция лаборатории: equity экспериментов группы и изменение от старта учёта"
              >
                Paper
              </TableHead>
              <TableHead
                className="text-right"
                title="Demo — демо-счёт Binance (demo.binance.com): equity кошелька в $"
              >
                Demo
              </TableHead>
              <TableHead
                className="text-right"
                title="Real — реальный счёт: торговый субсчёт Binance по последнему пульсу воркера, $"
              >
                Real
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="font-mono text-xs tabular-nums">
            {GROUPS.map((g) => {
              const b = data.budgets?.get(g.market);
              return (
                <TableRow key={g.market}>
                  <TableCell className="font-sans" title={g.label}>
                    {g.code}
                  </TableCell>
                  <TableCell className="text-right">
                    {b ? (
                      <>
                        <div>{formatUsd(b.equity)}</div>
                        {/* На телефоне Δ $ и % — двумя строками: таблица помещается в 375 px. */}
                        <div className={tone(b.change)}>
                          <span className="block sm:inline">
                            {signedUsd(b.change)}
                          </span>
                          <span className="hidden sm:inline"> · </span>
                          <span className="block sm:inline">
                            {signedPct(b.changePct)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <span title={data.budgetsError ?? undefined}>
                        {data.budgetsError ? "—" : "…"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <WalletCell data={data} account="demo" market={g.market} />
                  </TableCell>
                  <TableCell className="text-right">
                    <WalletCell data={data} account="real" market={g.market} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableFrame>
      {(notes.length > 0 || data.balancesError) && (
        <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
          {data.balancesError && <li>Demo и Real: — ({data.balancesError})</li>}
          {notes.map((n) => (
            <li key={`${n.account}:${n.hint}`}>
              {n.account}
              {n.codes.length > 0 && ` ${n.codes.join(", ")}`}: {n.hint}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {data.balances &&
            `Demo на ${formatDateTime(data.balances.at)}, Real — по пульсу`}
        </span>
        <Link
          href="/settings#groups"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Сбросы →
        </Link>
      </div>
    </div>
  );
}

/** Поповер с таблицей счетов; у каждого триггера свой — Radix позиционирует его от своего триггера. */
function TablePopover({
  data,
  children,
}: {
  data: Data;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      {children}
      <PopoverContent
        align="start"
        collisionPadding={16}
        className="w-auto max-w-[calc(100vw-2rem)] p-2 sm:p-3"
      >
        <BalancesTable data={data} />
      </PopoverContent>
    </Popover>
  );
}

/** Чип группы (≥ sm): крупно Paper (equity, %), мелко D и R. */
function GroupChip({
  data,
  group,
}: {
  data: Data;
  group: (typeof GROUPS)[number];
}) {
  const b = data.budgets?.get(group.market);
  const title = chipTitle({
    code: group.code,
    label: group.label,
    paper: b,
    paperError: data.budgetsError,
    demo: data.balances?.demo[group.market],
    real: data.balances?.real[group.market],
    balancesError: data.balancesError,
  });
  const small = (account: "demo" | "real") =>
    data.balancesError
      ? "—"
      : walletText(data.balances?.[account][group.market]);
  return (
    <TablePopover data={data}>
      <PopoverTrigger
        title={title}
        className="flex shrink-0 items-baseline gap-1.5 rounded-md border px-2 py-0.5 font-mono text-xs tabular-nums whitespace-nowrap transition-colors hover:bg-accent data-[state=open]:bg-accent"
      >
        <span className="font-sans text-muted-foreground">{group.code}</span>
        {b ? (
          <>
            <span>{formatUsd(b.equity)}</span>
            <span className={tone(b.change)}>{signedPct(b.changePct)}</span>
          </>
        ) : (
          <span>{data.budgetsError ? "—" : "…"}</span>
        )}
        <span className="text-[10px] text-muted-foreground">
          D {small("demo")} · R {small("real")}
        </span>
      </PopoverTrigger>
    </TablePopover>
  );
}

/**
 * Счета в шапке: на ≥ sm — три чипа групп, на телефоне — кнопка «Счета» с итогом Paper. Клик — поповер с таблицей
 * групп × счетов и ссылкой на сбросы.
 */
export function AccountBalances({ className }: { className?: string }) {
  const data = useAccountsData();
  const paperTotal = data.budgets
    ? [...data.budgets.values()].reduce((s, b) => s + b.equity, 0)
    : null;
  const paperInitial = data.budgets
    ? [...data.budgets.values()].reduce((s, b) => s + b.initial, 0)
    : 0;
  const paperChange = paperTotal === null ? 0 : paperTotal - paperInitial;
  return (
    <div className={cn("flex min-w-0 items-center", className)}>
      <div className="hidden flex-wrap items-center gap-x-2 gap-y-1 sm:flex">
        {GROUPS.map((g) => (
          <GroupChip key={g.market} data={data} group={g} />
        ))}
      </div>
      <div className="sm:hidden">
        <TablePopover data={data}>
          <PopoverTrigger
            title="Счета Paper, Demo и Real по группам активов"
            className="flex items-baseline gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap transition-colors hover:bg-accent data-[state=open]:bg-accent"
          >
            <span className="text-muted-foreground">Счета</span>
            {paperTotal !== null && (
              <>
                <span className="font-mono tabular-nums">
                  {formatUsd(paperTotal)}
                </span>
                <span
                  className={cn("font-mono tabular-nums", tone(paperChange))}
                >
                  {signedPct(paperInitial > 0 ? paperChange / paperInitial : 0)}
                </span>
              </>
            )}
          </PopoverTrigger>
        </TablePopover>
      </div>
    </div>
  );
}
