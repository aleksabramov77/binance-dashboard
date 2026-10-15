"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  assetGroupOf,
  type DemoSummary,
  describeConfig,
  EquityChart,
  type ExitReason,
  formatProfitFactor,
  formatR,
  formatRate,
  formatSignedUsd,
  MIRROR_STATUS_LABELS,
  type MirrorView,
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

/** Демо-счёт Binance эксперимента (spec 008): отдельно от paper, с последнего демо-сброса. */
function DemoMetrics({ d, mirrored }: { d: DemoSummary; mirrored: boolean }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        Демо-счёт Binance{" "}
        {mirrored ? "· торговля включена" : "· торговля выключена"}
      </h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Metric
          label="PnL демо"
          value={d.closed ? formatSignedUsd(d.pnl) : "—"}
          tone={pnlTone(d.pnl)}
        />
        <Metric
          label="Сделки демо"
          value={d.open ? `${d.closed} + ${d.open}` : String(d.closed)}
        />
        <Metric
          label="Win rate демо"
          value={d.closed ? formatRate(d.wins / d.closed) : "—"}
        />
        <Metric label="В плюс / в минус" value={`${d.wins} / ${d.losses}`} />
        <Metric
          label="Отказ / пропуск"
          value={`${d.rejected} / ${d.skipped}`}
        />
      </div>
    </section>
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
  "mirror",
] as const;
const HELP: Record<(typeof TRADE_SORT_KEYS)[number], string> = {
  openedAt: "Время входа в сделку (по закрытию свечи сигнала).",
  closedAt: "Время выхода. «открыта» — сделка ещё идёт.",
  symbol: "Торговая пара.",
  direction:
    "Лонг — покупка, зарабатывает на росте. Шорт — продажа, зарабатывает на падении (только USDⓈ-M).",
  entryPrice: "Цена входа с учётом проскальзывания 0,05%.",
  exitPrice: "Цена выхода: по стопу, тейку, трейлингу, времени или сигналу.",
  exitReason:
    "Почему сделка закрыта: тейк-профит, стоп-лосс, трейлинг-стоп, безубыток, тайм-стоп, противоположный сигнал или вручную (сброс капиталов).",
  pnl: "Прибыль или убыток сделки в $ после комиссий.",
  r: "Результат в R — в долях первоначального риска (расстояния до стопа). +2R — заработали двойной риск, −1R — сработал стоп.",
  mirror:
    "Зеркало сделки в Binance Demo: открыта с TP/SL, не открылась (причина — в подсказке при наведении), закрыта. Пусто — сделка не зеркалилась.",
};

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
  // Заполняется в TradesTable: статус зеркала хранится отдельно от сделки.
  mirror: () => null,
};

function MirrorCell({ mirror }: { mirror: MirrorView | undefined }) {
  if (!mirror) return <span className="text-muted-foreground">—</span>;
  const tone =
    mirror.status === "protected" || mirror.status === "closed"
      ? "outline"
      : mirror.status === "rejected" || mirror.status === "skipped"
        ? "secondary"
        : "destructive";
  return (
    <Badge variant={tone} title={mirror.message} className="font-normal">
      {MIRROR_STATUS_LABELS[mirror.status]}
    </Badge>
  );
}

function TradesTable({
  trades,
  mirrors,
}: {
  trades: PaperTrade[];
  mirrors: Record<string, MirrorView>;
}) {
  const { sort, head } = useTableSort("tradesSort", TRADE_SORT_KEYS);
  const rows = sort
    ? sortRows(
        trades,
        sort.key === "mirror"
          ? (t) => {
              const m = mirrors[t.id];
              return m ? MIRROR_STATUS_LABELS[m.status] : null;
            }
          : TRADE_SORT_VALUE[sort.key],
        sort.dir,
      )
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
            <SortableHead {...head("openedAt")} description={HELP.openedAt}>
              Вход
            </SortableHead>
            <SortableHead {...head("closedAt")} description={HELP.closedAt}>
              Выход
            </SortableHead>
            <SortableHead {...head("symbol")} description={HELP.symbol}>
              Символ
            </SortableHead>
            <SortableHead {...head("direction")} description={HELP.direction}>
              Направление
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("entryPrice")}
              description={HELP.entryPrice}
            >
              Цена входа
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("exitPrice")}
              description={HELP.exitPrice}
            >
              Цена выхода
            </SortableHead>
            <SortableHead {...head("exitReason")} description={HELP.exitReason}>
              Причина
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("pnl")}
              description={HELP.pnl}
            >
              PnL
            </SortableHead>
            <SortableHead
              className="text-right"
              {...head("r")}
              description={HELP.r}
            >
              R
            </SortableHead>
            <SortableHead {...head("mirror")} description={HELP.mirror}>
              Demo
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
              <TableCell>
                <MirrorCell mirror={mirrors[t.id]} />
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
                {assetGroupOf(data.experiment.market).label}
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
          <DemoMetrics d={data.demo} mirrored={data.experiment.demoMirror} />

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
            <TradesTable trades={data.trades} mirrors={data.mirrors} />
          </section>
        </>
      )}
    </div>
  );
}
