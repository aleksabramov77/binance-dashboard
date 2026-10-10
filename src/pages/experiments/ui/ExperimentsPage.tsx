"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo } from "react";
import {
  type ExperimentSummary,
  formatProfitFactor,
  formatRate,
  formatSignedUsd,
  pnlTone,
  useExperiments,
} from "@/entities/experiment";
import { cn, formatDateTime, formatUsd } from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { sortExperiments } from "../lib/sortExperiments";
import {
  MARKET_FILTERS,
  type MarketFilter,
  type SortKey,
  useExperimentsView,
} from "../model/useExperimentsView";

const MARKET_LABELS: Record<MarketFilter, string> = {
  all: "Все",
  spot: "Spot",
  futures: "Futures",
};

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: "id", label: "Эксперимент", numeric: false },
  { key: "trades", label: "Сделки", numeric: true },
  { key: "winRate", label: "Win rate", numeric: true },
  { key: "pnl", label: "PnL", numeric: true },
  { key: "profitFactor", label: "Profit factor", numeric: true },
  { key: "maxDrawdown", label: "Max DD", numeric: true },
  { key: "equity", label: "Equity", numeric: true },
];

function SortableHead({ column }: { column: (typeof COLUMNS)[number] }) {
  const [{ sort, dir }, setView] = useExperimentsView();
  const active = sort === column.key;
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      className={cn(column.numeric && "text-right")}
      aria-sort={
        active ? (dir === "asc" ? "ascending" : "descending") : undefined
      }
    >
      <button
        type="button"
        className={cn(
          "inline-flex items-center gap-1 hover:text-foreground",
          active && "text-foreground",
        )}
        onClick={() =>
          setView({
            sort: column.key,
            // Повторный клик меняет направление; новая числовая колонка — сначала лучшие.
            dir: active
              ? dir === "asc"
                ? "desc"
                : "asc"
              : column.numeric && column.key !== "maxDrawdown"
                ? "desc"
                : "asc",
          })
        }
      >
        {column.label}
        {active && <Arrow className="size-3" aria-hidden />}
      </button>
    </TableHead>
  );
}

function ExperimentRow({ e }: { e: ExperimentSummary }) {
  const s = e.stats;
  return (
    <TableRow className={cn(!e.enabled && "opacity-50")}>
      <TableCell className="max-w-md whitespace-normal">
        <Link
          href={`/experiments/${encodeURIComponent(e.id)}`}
          className="group flex flex-col gap-0.5"
        >
          <span className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">
              {e.id}
            </span>
            <span className="font-medium group-hover:underline">{e.name}</span>
            <Badge variant="outline" className="text-[10px]">
              {MARKET_LABELS[e.market]}
            </Badge>
            {!e.enabled && <Badge variant="outline">выключен</Badge>}
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {e.hypothesis}
          </span>
        </Link>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {s.closed}
        {s.open > 0 && (
          <span className="text-muted-foreground"> +{s.open}</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatRate(s.winRate)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono font-semibold tabular-nums",
          pnlTone(s.realizedPnl),
        )}
      >
        {s.closed ? formatSignedUsd(s.realizedPnl) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatProfitFactor(s.profitFactor, s.grossProfit)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {s.closed ? formatRate(-s.maxDrawdownPct) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatUsd(s.equity)}
      </TableCell>
    </TableRow>
  );
}

function ExperimentsDashboard() {
  const { data, isPending, error } = useExperiments();
  const [{ market, sort, dir }, setView] = useExperimentsView();
  const rows = useMemo(
    () => sortExperiments(data?.experiments ?? [], market, sort, dir),
    [data, market, sort, dir],
  );
  const total = data?.experiments.reduce((n, e) => n + e.stats.trades, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Эксперименты
          </h1>
          <p className="text-sm text-muted-foreground">
            {data?.experiments.length ?? 40} paper-стратегий на реальных свечах
            Binance, без настоящих ордеров.
            {data &&
              ` Эпоха №${data.run.id} с ${formatDateTime(data.run.startedAt)}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/stats"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Разрезы по монетам и направлениям →
          </Link>
          <Tabs
            value={market}
            onValueChange={(v) =>
              setView({
                market: MARKET_FILTERS.find((m) => m === v) ?? "all",
              })
            }
          >
            <TabsList>
              {MARKET_FILTERS.map((m) => (
                <TabsTrigger key={m} value={m}>
                  {MARKET_LABELS[m]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </header>

      {isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {error && <p className="text-destructive">{error.message}</p>}

      {data && total === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {data.engineEnabled
            ? "Движок включён, сделок пока нет: стратегии ждут закрытия свечи и сигнала."
            : "Движок выключен — сделок нет. Включите «Автоторговлю» в шапке, чтобы эксперименты начали торговать на бумаге."}
        </p>
      )}

      {data && (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <SortableHead key={c.key} column={c} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <ExperimentRow key={e.id} e={e} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          Сделки — закрытые (+ открытые). PnL — реализованный, за вычетом
          комиссий. Equity = стартовый капитал + PnL. Max DD — наибольшая
          просадка equity от пика.
        </p>
      )}
    </div>
  );
}

export function ExperimentsPage() {
  return (
    <Suspense>
      <ExperimentsDashboard />
    </Suspense>
  );
}
