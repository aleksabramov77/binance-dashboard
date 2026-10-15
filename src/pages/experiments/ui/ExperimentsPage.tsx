"use client";

import Link from "next/link";
import { useQueryState } from "nuqs";
import { Suspense, useMemo } from "react";
import {
  ASSET_GROUP_DESCRIPTION,
  ASSET_GROUPS,
  assetGroupOf,
  DemoMisses,
  type ExperimentSummary,
  formatProfitFactor,
  formatRate,
  formatSignedUsd,
  pnlTone,
  useExperiments,
} from "@/entities/experiment";
import { DemoMirrorToggle } from "@/features/demo-mirror-toggle";
import {
  cn,
  formatDateTime,
  formatUsd,
  saveSort,
  useRestoreSort,
} from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { SortableHead } from "@/shared/ui/sortable-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { sortExperiments } from "../lib/sortExperiments";
import {
  MARKET_FILTERS,
  type MarketFilter,
  SORT_KEYS,
  type SortKey,
  useExperimentsView,
} from "../model/useExperimentsView";

const MARKET_LABELS: Record<MarketFilter, string> = {
  all: "Все",
  spot: ASSET_GROUPS.spot.code,
  futures: ASSET_GROUPS.futures.code,
};

const COLUMNS: {
  key: SortKey;
  label: string;
  numeric: boolean;
  description: string;
}[] = [
  {
    key: "id",
    label: "Эксперимент",
    numeric: false,
    description:
      "Код, название и гипотеза эксперимента. Клик по строке — подробности, конфиг и сделки.",
  },
  {
    key: "ag",
    label: "AG",
    numeric: false,
    description: ASSET_GROUP_DESCRIPTION,
  },
  {
    key: "trades",
    label: "Сделки",
    numeric: true,
    description: "Закрытые сделки текущей эпохи (+ открытые сейчас).",
  },
  {
    key: "winRate",
    label: "Win rate",
    numeric: true,
    description: "Доля прибыльных среди закрытых сделок.",
  },
  {
    key: "pnl",
    label: "PnL",
    numeric: true,
    description:
      "Реализованная прибыль или убыток закрытых сделок после комиссий.",
  },
  {
    key: "profitFactor",
    label: "Profit factor",
    numeric: true,
    description:
      "Сумма прибылей / сумма убытков. Больше 1 — стратегия зарабатывает; ∞ — убытков ещё не было.",
  },
  {
    key: "maxDrawdown",
    label: "Max DD",
    numeric: true,
    description:
      "Наибольшая просадка equity от пика, в % от стартового капитала.",
  },
  {
    key: "equity",
    label: "Equity",
    numeric: true,
    description: "Капитал эксперимента: стартовый бюджет + реализованный PnL.",
  },
  {
    key: "demo",
    label: "Демо: торговля",
    numeric: false,
    description:
      "Галочка — эксперимент торгует и на демо-счёте Binance (demo.binance.com, виртуальные деньги): каждый новый вход повторяется на бирже с тем же объёмом, стопом и тейком. Включение и выключение — с подтверждением.",
  },
  {
    key: "demoTrades",
    label: "Демо: сделки",
    numeric: true,
    description:
      "Сделки на демо-счёте с последнего демо-сброса: закрытые (+ открытые сейчас). «отказ» — биржа не приняла вход (монеты нет на демо, мин. объём); «пропуск» — зеркало само не повторяло вход (по монете уже есть позиция другого эксперимента, вход старше 10 минут).",
  },
  {
    key: "demoWinRate",
    label: "Демо: win rate",
    numeric: true,
    description: "Доля прибыльных среди закрытых сделок на демо-счёте.",
  },
  {
    key: "demoPnl",
    label: "Демо: PnL",
    numeric: true,
    description:
      "Плюс или минус на демо-счёте по эксперименту с последнего демо-сброса, $, без комиссий: (цена выхода − цена входа на бирже) × количество. Выход — фактическая цена, если позицию закрыло зеркало, иначе (TP/SL биржи) — цена выхода paper-сделки. Точная история ордеров — «Сигналы» → «Демо-сделки».",
  },
];

function ColumnHead({ column }: { column: (typeof COLUMNS)[number] }) {
  const [{ sort, dir }, setView] = useExperimentsView();
  return (
    <SortableHead
      className={cn(
        column.numeric && "text-right",
        column.key === "demo" && "text-center",
      )}
      active={sort === column.key}
      dir={dir}
      onSort={(next) => {
        void setView({ sort: column.key, dir: next });
        saveSort("experiments", { key: column.key, dir: next });
      }}
      onReset={() => {
        void setView({ sort: null, dir: null });
        saveSort("experiments", null);
      }}
      description={column.description}
    >
      {column.label}
    </SortableHead>
  );
}

function DemoCells({
  e,
  demoConfigured,
}: {
  e: ExperimentSummary;
  demoConfigured: boolean;
}) {
  const d = e.demo;
  return (
    <>
      <TableCell className="text-center">
        <DemoMirrorToggle experiment={e} demoConfigured={demoConfigured} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {d.trades || d.rejected || d.skipped ? (
          <>
            {d.closed}
            {d.open > 0 && (
              <span className="text-muted-foreground"> +{d.open}</span>
            )}
            <DemoMisses d={d} />
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {d.closed ? formatRate(d.wins / d.closed) : "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono font-semibold tabular-nums",
          pnlTone(d.pnl),
        )}
      >
        {d.closed ? formatSignedUsd(d.pnl) : "—"}
      </TableCell>
    </>
  );
}

function ExperimentRow({
  e,
  demoConfigured,
}: {
  e: ExperimentSummary;
  demoConfigured: boolean;
}) {
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
            {!e.enabled && <Badge variant="outline">выключен</Badge>}
          </span>
          <span className="line-clamp-1 text-xs text-muted-foreground">
            {e.hypothesis}
          </span>
        </Link>
      </TableCell>
      <TableCell>
        <Badge
          variant="outline"
          className="font-mono text-[10px]"
          title={assetGroupOf(e.market).description}
        >
          {assetGroupOf(e.market).code}
        </Badge>
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
      <DemoCells e={e} demoConfigured={demoConfigured} />
    </TableRow>
  );
}

function ExperimentsDashboard() {
  const { data, isPending, error } = useExperiments();
  const [{ market, sort, dir }, setView] = useExperimentsView();
  // Последняя сортировка из localStorage, если в URL её нет.
  const [urlSort] = useQueryState("sort");
  useRestoreSort("experiments", SORT_KEYS, urlSort !== null, (saved) =>
    setView({ sort: saved.key, dir: saved.dir }),
  );
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
                  <ColumnHead key={c.key} column={c} />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <ExperimentRow
                  key={e.id}
                  e={e}
                  demoConfigured={data.demoConfigured}
                />
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
