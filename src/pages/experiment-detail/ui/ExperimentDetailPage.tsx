"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import {
  assetGroupOf,
  type DemoSummary,
  DisabledBadge,
  describeConfig,
  describeRunView,
  EquityChart,
  type ExitReason,
  formatProfitFactor,
  formatR,
  formatRate,
  formatSignedUsd,
  MIRROR_STATUS_LABELS,
  type MirrorView,
  MissingRunNotice,
  type PaperTrade,
  pnlTone,
  RunSelect,
  runEnd,
  type TradeStatsView,
  useExperiment,
} from "@/entities/experiment";
import { ExperimentEnabledSwitch } from "@/features/experiment-toggle";
import {
  cn,
  defineSortTable,
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
  TableFrame,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { enabledFamilyVariants } from "../lib/familyVariants";
import { useDetailView } from "../model/useDetailView";
import { VariantFamily } from "./VariantFamily";

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
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  /** Подсказка по наведению. */
  hint?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2"
      title={hint}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn("font-mono text-lg font-semibold tabular-nums", tone)}
      >
        {value}
      </span>
    </div>
  );
}

/** Бюджет прошлых эпох не хранится (PRD «Открытые вопросы»): проценты — от текущего. */
const BUDGET_HINT =
  "Equity, процент и просадка считаются от текущего стартового бюджета эксперимента: бюджет прошлых эпох не хранится.";

function Metrics({ s }: { s: TradeStatsView }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      <Metric label="Equity" value={formatUsd(s.equity)} hint={BUDGET_HINT} />
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
        hint={BUDGET_HINT}
      />
      <Metric label="Комиссии" value={formatUsd(s.fees)} />
    </div>
  );
}

/** Демо-счёт Binance эксперимента (spec 008): отдельно от paper, за период страницы. */
function DemoMetrics({
  d,
  mirrored,
  period,
}: {
  d: DemoSummary;
  mirrored: boolean;
  /** За что сводка: с последнего демо-сброса, зеркала эпохи или все. */
  period: string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-muted-foreground">
        Демо-счёт Binance{" "}
        {mirrored ? "· торговля включена" : "· торговля выключена"} · {period}
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
  "run",
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
// Маршрут без id: одна сортировка сделок на все эксперименты (решение пользователя 2026-10-15).
const TRADES_TABLE = defineSortTable(
  "experiments/[id]:trades",
  TRADE_SORT_KEYS,
);
const HELP: Record<(typeof TRADE_SORT_KEYS)[number], string> = {
  run: "Эпоха учёта, в которой открыта сделка (видна в «Все эпохи»).",
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
  run: (t) => t.runId,
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
  showRun,
}: {
  trades: PaperTrade[];
  mirrors: Record<string, MirrorView>;
  /** «Все эпохи»: колонка «Эпоха» (spec 0046). */
  showRun: boolean;
}) {
  const { sort, head } = useTableSort(TRADES_TABLE);
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
        За выбранный период сделок нет.
      </p>
    );
  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <TableRow>
            {showRun && (
              <SortableHead
                className="text-right"
                {...head("run")}
                description={HELP.run}
              >
                Эпоха
              </SortableHead>
            )}
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
              {showRun && (
                <TableCell className="text-right font-mono tabular-nums">
                  №{t.runId}
                </TableCell>
              )}
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
    </TableFrame>
  );
}

export function ExperimentDetailPage({ id }: { id: string }) {
  const [{ run }, setView] = useDetailView();
  const { data, isPending, error } = useExperiment(id, run);
  const all = data?.scope === "all";
  const current = !!data && data.scope === data.runs[0]?.id;
  const period = data ? describeRunView(data) : "";
  // Переходы со страницы сохраняют выбранный период (?run=).
  const runQuery = run === null ? "" : `?run=${run}`;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/experiments${runQuery}`}
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
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2">
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
                  <DisabledBadge disabled={data.disabled} />
                )}
                <ExperimentEnabledSwitch
                  experiment={data.experiment}
                  variants={enabledFamilyVariants(
                    data.experiment.id,
                    data.family,
                  )}
                />
              </div>
              <p className="max-w-3xl text-muted-foreground">
                {data.experiment.hypothesis}
              </p>
              {data.disabled?.note && (
                <p className="max-w-3xl text-sm">
                  <span className="text-muted-foreground">
                    Почему выключен:{" "}
                  </span>
                  {data.disabled.note}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {period} · старт {formatUsd(data.experiment.initialBudget)}
                {!data.engineEnabled && " · движок выключен"}
              </p>
            </div>
            <RunSelect view={data} onChange={(r) => setView({ run: r })} />
          </header>

          <MissingRunNotice
            view={data}
            onReset={() => setView({ run: null })}
          />

          <Metrics s={data.stats} />
          {!current && (
            <p className="-mt-4 text-xs text-muted-foreground">{BUDGET_HINT}</p>
          )}
          <DemoMetrics
            d={data.demo}
            mirrored={data.experiment.demoMirror}
            period={
              all
                ? "все демо-зеркала"
                : current
                  ? "с последнего демо-сброса"
                  : `зеркала сделок эпохи №${data.run.id}`
            }
          />

          {data.family && (
            <VariantFamily
              experiment={data.experiment}
              family={data.family}
              period={period}
              runQuery={runQuery}
            />
          )}

          <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
            <Card>
              <CardHeader>
                <CardTitle>Equity</CardTitle>
              </CardHeader>
              <CardContent>
                <EquityChart
                  points={data.equity}
                  initialBudget={data.experiment.initialBudget}
                  marks={
                    all
                      ? data.runs.map((r) => ({
                          at: r.startedAt,
                          label: `эпоха №${r.id}`,
                        }))
                      : []
                  }
                  end={all ? null : runEnd(data.runs, data.run.id)}
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
            <TradesTable
              trades={data.trades}
              mirrors={data.mirrors}
              showRun={all}
            />
          </section>
        </>
      )}
    </div>
  );
}
