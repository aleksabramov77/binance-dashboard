"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  describeConfig,
  EquityChart,
  type ExitReason,
  formatProfitFactor,
  formatR,
  formatRate,
  formatSignedUsd,
  type PaperTrade,
  pnlTone,
  type TradeStatsView,
  useExperiment,
} from "@/entities/experiment";
import {
  cn,
  formatDateTime,
  formatPair,
  formatPrice,
  formatUsd,
  type SortValue,
  sortRows,
  useTableSort,
} from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { SortableHead } from "@/shared/ui/sortable-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

const EXIT_LABELS: Record<ExitReason, string> = {
  tp: "тейк",
  sl: "стоп",
  trail: "трейлинг",
  breakeven: "безубыток",
  time: "по времени",
  signal: "по сигналу",
  manual: "вручную",
};

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn("font-mono text-lg font-semibold tabular-nums", tone)}
      >
        {value}
      </span>
    </div>
  );
}

function Metrics({ s }: { s: TradeStatsView }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      <Metric label="Equity" value={formatUsd(s.equity)} />
      <Metric
        label="PnL"
        value={formatSignedUsd(s.realizedPnl)}
        tone={pnlTone(s.realizedPnl)}
      />
      <Metric
        label="Сделки"
        value={s.open ? `${s.closed} + ${s.open}` : String(s.closed)}
      />
      <Metric label="Win rate" value={formatRate(s.winRate)} />
      <Metric
        label="Profit factor"
        value={formatProfitFactor(s.profitFactor, s.grossProfit)}
      />
      <Metric label="Средний R" value={formatR(s.avgR)} />
      <Metric
        label="Max DD"
        value={s.closed ? formatRate(-s.maxDrawdownPct) : "—"}
      />
      <Metric label="Комиссии" value={formatUsd(s.fees)} />
    </div>
  );
}

const TRADE_SORT_KEYS = [
  "openedAt",
  "closedAt",
  "symbol",
  "direction",
  "entryPrice",
  "exitPrice",
  "exitReason",
  "pnl",
  "r",
] as const;
const TRADE_SORT_VALUE: Record<
  (typeof TRADE_SORT_KEYS)[number],
  (t: PaperTrade) => SortValue
> = {
  openedAt: (t) => Date.parse(t.openedAt),
  // Открытые сделки (без выхода) — в конце.
  closedAt: (t) => (t.closedAt ? Date.parse(t.closedAt) : null),
  symbol: (t) => t.symbol,
  direction: (t) => t.direction,
  entryPrice: (t) => t.entryPrice,
  exitPrice: (t) => t.exitPrice,
  exitReason: (t) => (t.exitReason ? EXIT_LABELS[t.exitReason] : null),
  pnl: (t) => t.pnl,
  r: (t) => t.rMultiple,
};

function TradesTable({ trades }: { trades: PaperTrade[] }) {
  const { sort, head } = useTableSort("tradesSort", TRADE_SORT_KEYS);
  const rows = sort
    ? sortRows(trades, TRADE_SORT_VALUE[sort.key], sort.dir)
    : trades;
  if (trades.length === 0)
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        В этой эпохе сделок ещё нет.
      </p>
    );
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead {...head("openedAt", "desc")}>Вход</SortableHead>
            <SortableHead {...head("closedAt", "desc")}>Выход</SortableHead>
            <SortableHead {...head("symbol")}>Символ</SortableHead>
            <SortableHead {...head("direction")}>Направление</SortableHead>
            <SortableHead
              className="text-right"
              {...head("entryPrice", "desc")}
            >
              Цена входа
            </SortableHead>
            <SortableHead className="text-right" {...head("exitPrice", "desc")}>
              Цена выхода
            </SortableHead>
            <SortableHead {...head("exitReason")}>Причина</SortableHead>
            <SortableHead className="text-right" {...head("pnl", "desc")}>
              PnL
            </SortableHead>
            <SortableHead className="text-right" {...head("r", "desc")}>
              R
            </SortableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => (
            <TableRow key={t.id}>
              <TableCell className="text-sm tabular-nums">
                {formatDateTime(t.openedAt)}
              </TableCell>
              <TableCell className="text-sm tabular-nums">
                {t.closedAt ? (
                  formatDateTime(t.closedAt)
                ) : (
                  <Badge variant="outline">открыта</Badge>
                )}
              </TableCell>
              <TableCell className="font-medium">
                {formatPair(t.symbol)}
              </TableCell>
              <TableCell
                className={
                  t.direction === "long" ? "text-positive" : "text-destructive"
                }
              >
                {t.direction === "long" ? "лонг" : "шорт"}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatPrice(t.entryPrice)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {t.exitPrice === null ? "—" : formatPrice(t.exitPrice)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {t.exitReason ? EXIT_LABELS[t.exitReason] : "—"}
              </TableCell>
              <TableCell
                className={cn(
                  "text-right font-mono font-semibold tabular-nums",
                  pnlTone(t.pnl),
                )}
              >
                {t.pnl === null ? "—" : formatSignedUsd(t.pnl)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {formatR(t.rMultiple)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ExperimentDetailPage({ id }: { id: string }) {
  const { data, isPending, error } = useExperiment(id);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/experiments"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Все эксперименты
      </Link>

      {isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {error && <p className="text-destructive">{error.message}</p>}
      {data === null && (
        <p className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          Эксперимента «{id}» нет в каталоге.
        </p>
      )}

      {data && (
        <>
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-muted-foreground">
                {data.experiment.id}
              </span>
              <h1 className="text-2xl font-semibold tracking-tight">
                {data.experiment.name}
              </h1>
              <Badge variant="outline">
                {data.experiment.market === "spot" ? "Spot" : "Futures"}
              </Badge>
              {!data.experiment.enabled && (
                <Badge variant="outline">выключен</Badge>
              )}
            </div>
            <p className="max-w-3xl text-muted-foreground">
              {data.experiment.hypothesis}
            </p>
            <p className="text-xs text-muted-foreground">
              Эпоха №{data.run.id} с {formatDateTime(data.run.startedAt)} ·
              старт {formatUsd(data.experiment.initialBudget)}
              {!data.engineEnabled && " · движок выключен"}
            </p>
          </header>

          <Metrics s={data.stats} />

          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <Card>
              <CardHeader>
                <CardTitle>Equity</CardTitle>
              </CardHeader>
              <CardContent>
                <EquityChart
                  points={data.equity}
                  initialBudget={data.experiment.initialBudget}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Правила</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  {describeConfig(data.experiment.config).map((l) => (
                    <div key={l.label} className="contents">
                      <dt className="text-muted-foreground">{l.label}</dt>
                      <dd>{l.value}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>

          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">
              Сделки
              {data.stats.trades > data.trades.length &&
                ` (последние ${data.trades.length} из ${data.stats.trades})`}
            </h2>
            <TradesTable trades={data.trades} />
          </section>
        </>
      )}
    </div>
  );
}
