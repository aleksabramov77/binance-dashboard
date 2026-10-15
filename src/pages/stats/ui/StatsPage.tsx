"use client";

import { ArrowLeft, Ban } from "lucide-react";
import Link from "next/link";
import { Suspense, useMemo } from "react";
import {
  assetGroupOf,
  blacklistCandidates,
  formatProfitFactor,
  formatR,
  formatRate,
  formatSignedUsd,
  pnlTone,
  rankGroups,
  type StatsGroupBy,
  type StatsGroupView,
  type StatsPeriod,
  type TradeStatsResponse,
  type TradeStatsView,
  useTradeStats,
} from "@/entities/experiment";
import {
  cn,
  defineSortTable,
  formatDateTime,
  formatUsd,
  type SavedSort,
  type SortHeadProps,
  useTableSort,
} from "@/shared/lib";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { SortableHead } from "@/shared/ui/sortable-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  GROUP_SORT_KEYS,
  type GroupSortKey,
  sortGroups,
} from "../lib/sortGroups";
import {
  DIRECTION_FILTERS,
  MARKET_FILTERS,
  useStatsView,
} from "../model/useStatsView";

const SORT_TABLE = defineSortTable("stats:groups", GROUP_SORT_KEYS);
/** Без сохранённой сортировки — самые прибыльные группы сверху. */
const DEFAULT_SORT: SavedSort<GroupSortKey> = { key: "pnl", dir: "desc" };

const GROUP_BY_LABELS: Record<StatsGroupBy, string> = {
  experiment: "Эксперимент",
  market: "Рынок",
  symbol: "Монета",
  direction: "Направление",
};
const PERIOD_LABELS: Record<StatsPeriod, string> = {
  epoch: "Эпоха",
  "24h": "24 ч",
  "7d": "7 дн",
};
const DIRECTION_LABELS = { long: "Long (B)", short: "Short (S)" } as const;
/** Значение «все» в Select (у Radix пустое значение запрещено). */
const ALL = "all";
/** Сколько худших монет подсвечивать как кандидатов в blacklist. */
const BLACKLIST_SIZE = 5;

const COLUMNS: {
  key: GroupSortKey;
  label: string;
  numeric: boolean;
  description: string;
}[] = [
  {
    key: "key",
    label: "Группа",
    numeric: false,
    description:
      "Группа разреза: эксперимент, рынок, монета или направление (вкладки сверху).",
  },
  {
    key: "trades",
    label: "Сделки",
    numeric: true,
    description: "Закрытые сделки группы за период (+ открытые сейчас).",
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
    key: "fees",
    label: "Комиссии",
    numeric: true,
    description: "Комиссии биржи (taker) — уже вычтены из PnL.",
  },
  {
    key: "profitFactor",
    label: "Profit factor",
    numeric: true,
    description:
      "Сумма прибылей / сумма убытков. Больше 1 — группа зарабатывает; ∞ — убытков ещё не было.",
  },
  {
    key: "avgR",
    label: "Средний R",
    numeric: true,
    description:
      "Средний результат сделки в R (долях риска до стопа). Выше 0 — у стратегии есть преимущество.",
  },
  {
    key: "maxDrawdown",
    label: "Max DD",
    numeric: true,
    description:
      "Наибольшая просадка накопленного PnL группы от пика, в $ (и в % от пика equity для экспериментов и рынков).",
  },
];

function ColumnHead({
  column,
  head,
}: {
  column: (typeof COLUMNS)[number];
  head: SortHeadProps;
}) {
  return (
    <SortableHead
      className={cn(column.numeric && "text-right")}
      {...head}
      description={column.description}
    >
      {column.label}
    </SortableHead>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className={cn("min-w-32", className)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Filters({ data }: { data: TradeStatsResponse | null | undefined }) {
  const [view, setView] = useStatsView();
  const experiments = (data?.options.experiments ?? []).filter(
    (e) => view.market === null || e.market === view.market,
  );
  const symbols = data?.options.symbols ?? [];
  const filtered =
    view.market !== null ||
    view.experiment !== null ||
    view.direction !== null ||
    view.symbol !== null ||
    view.period !== "epoch" ||
    view.run !== null;

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3">
      <FilterSelect
        label="Рынок"
        value={view.market ?? ALL}
        onChange={(v) =>
          setView({
            market: MARKET_FILTERS.find((m) => m === v) ?? null,
            // Эксперимент другого рынка под новый фильтр не попадёт — сбрасываем.
            experiment: null,
          })
        }
        options={[
          { value: ALL, label: "Все" },
          ...MARKET_FILTERS.map((m) => ({
            value: m,
            label: assetGroupOf(m).label,
          })),
        ]}
      />
      <FilterSelect
        label="Эксперимент"
        value={view.experiment ?? ALL}
        onChange={(v) => setView({ experiment: v === ALL ? null : v })}
        className="max-w-64"
        options={[
          { value: ALL, label: "Все" },
          ...experiments.map((e) => ({
            value: e.id,
            label: `${e.id} · ${e.name}`,
          })),
        ]}
      />
      <FilterSelect
        label="Направление"
        value={view.direction ?? ALL}
        onChange={(v) =>
          setView({ direction: DIRECTION_FILTERS.find((d) => d === v) ?? null })
        }
        options={[
          { value: ALL, label: "Все" },
          ...DIRECTION_FILTERS.map((d) => ({
            value: d,
            label: DIRECTION_LABELS[d],
          })),
        ]}
      />
      <FilterSelect
        label="Монета"
        value={view.symbol ?? ALL}
        onChange={(v) => setView({ symbol: v === ALL ? null : v })}
        options={[
          { value: ALL, label: "Все" },
          ...symbols.map((s) => ({ value: s, label: s })),
        ]}
      />
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Период</span>
        <Tabs
          value={view.period}
          onValueChange={(v) =>
            setView({
              period:
                (Object.keys(PERIOD_LABELS) as StatsPeriod[]).find(
                  (p) => p === v,
                ) ?? "epoch",
            })
          }
        >
          <TabsList>
            {(Object.keys(PERIOD_LABELS) as StatsPeriod[]).map((p) => (
              <TabsTrigger key={p} value={p}>
                {PERIOD_LABELS[p]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {data && data.runs.length > 1 && (
        <FilterSelect
          label="Эпоха"
          value={String(view.run ?? data.runs[0].id)}
          onChange={(v) => {
            const id = Number(v);
            setView({ run: id === data.runs[0].id ? null : id });
          }}
          options={data.runs.map((r, i) => ({
            value: String(r.id),
            label: `№${r.id}${i === 0 ? " (текущая)" : ""} с ${formatDateTime(r.startedAt)}`,
          }))}
        />
      )}
      {filtered && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setView({
              market: null,
              experiment: null,
              direction: null,
              symbol: null,
              period: null,
              run: null,
            })
          }
        >
          Сбросить фильтры
        </Button>
      )}
    </div>
  );
}

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

function Totals({ s }: { s: TradeStatsView }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      <Metric label="Сделки (закрыто)" value={`${s.trades} (${s.closed})`} />
      <Metric label="Win rate" value={formatRate(s.winRate)} />
      <Metric
        label="PnL"
        value={s.closed ? formatSignedUsd(s.realizedPnl) : "—"}
        tone={pnlTone(s.realizedPnl)}
      />
      <Metric label="Комиссии" value={formatUsd(s.fees)} />
      <Metric
        label="Profit factor"
        value={formatProfitFactor(s.profitFactor, s.grossProfit)}
      />
      <Metric label="Средний R" value={formatR(s.avgR)} />
    </div>
  );
}

function RankList({
  title,
  groups,
  empty,
}: {
  title: string;
  groups: StatsGroupView[];
  empty: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-3">
      <span className="text-sm font-medium">{title}</span>
      {groups.length === 0 ? (
        <span className="text-sm text-muted-foreground">{empty}</span>
      ) : (
        <ol className="flex flex-col gap-1">
          {groups.map((g, i) => (
            <li
              key={g.key}
              className="flex items-baseline justify-between gap-3 text-sm"
            >
              <span className="truncate">
                <span className="text-muted-foreground">{i + 1}. </span>
                {g.label}
              </span>
              <span
                className={cn(
                  "shrink-0 font-mono tabular-nums",
                  pnlTone(g.stats.realizedPnl),
                )}
              >
                {formatSignedUsd(g.stats.realizedPnl)}
                <span className="text-muted-foreground">
                  {" "}
                  · {g.stats.closed} сд.
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GroupLabel({
  g,
  groupBy,
  flagged,
}: {
  g: StatsGroupView;
  groupBy: StatsGroupBy;
  flagged: boolean;
}) {
  return (
    <span className="flex items-center gap-2">
      {groupBy === "experiment" ? (
        <Link
          href={`/experiments/${encodeURIComponent(g.key)}`}
          className="font-medium hover:underline"
        >
          {g.label}
        </Link>
      ) : (
        <span
          className={cn("font-medium", groupBy === "symbol" && "font-mono")}
        >
          {g.label}
        </span>
      )}
      {flagged && (
        <Badge variant="destructive" className="gap-1 text-[10px]">
          <Ban className="size-3" aria-hidden />в blacklist?
        </Badge>
      )}
    </span>
  );
}

function GroupRow({
  g,
  groupBy,
  flagged,
}: {
  g: StatsGroupView;
  groupBy: StatsGroupBy;
  flagged: boolean;
}) {
  const s = g.stats;
  return (
    <TableRow className={cn(flagged && "bg-destructive/5")}>
      <TableCell className="max-w-md whitespace-normal">
        <GroupLabel g={g} groupBy={groupBy} flagged={flagged} />
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
      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {s.closed ? formatUsd(s.fees) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatProfitFactor(s.profitFactor, s.grossProfit)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatR(s.avgR)}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {s.closed ? (
          <>
            {/* Без просадки — «0 $», а не «−0,00 $»; доля меньше 0,05 % не показывается. */}
            {formatUsd(s.maxDrawdown > 0 ? -s.maxDrawdown : 0)}
            {s.initialBudget > 0 && s.maxDrawdownPct >= 0.0005 && (
              <span className="block text-xs">
                {formatRate(-s.maxDrawdownPct)}
              </span>
            )}
          </>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}

function StatsDashboard() {
  const [view, setView] = useStatsView();
  const { sort, head } = useTableSort(SORT_TABLE, DEFAULT_SORT);
  const { data, isPending, error, isPlaceholderData } = useTradeStats({
    groupBy: view.groupBy,
    market: view.market ?? undefined,
    experiment: view.experiment ?? undefined,
    direction: view.direction ?? undefined,
    symbol: view.symbol ?? undefined,
    period: view.period,
    run: view.run ?? undefined,
  });
  const groups = data?.groups;
  const rows = useMemo(
    () => sortGroups(groups ?? [], sort.key, sort.dir),
    [groups, sort],
  );
  const ranked = useMemo(() => rankGroups(groups ?? []), [groups]);
  // Подсветка — только когда показан разрез по монете (данные могут быть от прежнего разреза).
  const bySymbol =
    view.groupBy === "symbol" && data?.query.groupBy === "symbol";
  const flagged = useMemo(
    () =>
      bySymbol
        ? blacklistCandidates(groups ?? [], BLACKLIST_SIZE)
        : new Set<string>(),
    [bySymbol, groups],
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href="/experiments"
            className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Эксперименты
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Разрезы</h1>
          <p className="text-sm text-muted-foreground">
            Paper-сделки лаборатории по экспериментам, рынкам, монетам и
            направлениям.
            {data &&
              ` Эпоха №${data.run.id} с ${formatDateTime(data.run.startedAt)}${
                data.since ? `, сделки с ${formatDateTime(data.since)}` : ""
              }.`}
          </p>
        </div>
        <Tabs
          value={view.groupBy}
          onValueChange={(v) =>
            setView({
              groupBy:
                (Object.keys(GROUP_BY_LABELS) as StatsGroupBy[]).find(
                  (g) => g === v,
                ) ?? "experiment",
            })
          }
        >
          <TabsList>
            {(Object.keys(GROUP_BY_LABELS) as StatsGroupBy[]).map((g) => (
              <TabsTrigger key={g} value={g}>
                {GROUP_BY_LABELS[g]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </header>

      <Filters data={data} />

      {isPending && <p className="text-muted-foreground">Загрузка…</p>}
      {error && <p className="text-destructive">{error.message}</p>}
      {data === null && (
        <p className="text-destructive">
          Такой эпохи нет.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setView({ run: null })}
          >
            Открыть текущую
          </button>
        </p>
      )}

      {data && (
        <div
          className={cn(
            "flex flex-col gap-6 transition-opacity",
            isPlaceholderData && "opacity-60",
          )}
        >
          <Totals s={data.total} />

          {data.total.trades === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Под эти фильтры сделок нет. Смените период или сбросьте фильтры.
            </p>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <RankList
                  title={`Лучшие: ${GROUP_BY_LABELS[data.query.groupBy].toLowerCase()}`}
                  groups={ranked.best}
                  empty="Прибыльных групп пока нет."
                />
                <RankList
                  title={`Худшие: ${GROUP_BY_LABELS[data.query.groupBy].toLowerCase()}`}
                  groups={ranked.worst}
                  empty="Убыточных групп нет."
                />
              </div>

              {bySymbol && flagged.size > 0 && (
                <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <Ban
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                    aria-hidden
                  />
                  <span>
                    Кандидаты в blacklist — монеты с наибольшим убытком:{" "}
                    <span className="font-mono">{[...flagged].join(", ")}</span>
                    . Решение — за вами: проверьте, не случайна ли выборка (мало
                    сделок).
                  </span>
                </p>
              )}

              <div className="overflow-clip rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {COLUMNS.map((c) => (
                        <ColumnHead key={c.key} column={c} head={head(c.key)} />
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((g) => (
                      <GroupRow
                        key={g.key}
                        g={g}
                        groupBy={data.query.groupBy}
                        flagged={flagged.has(g.key)}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          <p className="text-xs text-muted-foreground">
            Сделки — закрытые (+ открытые). PnL — реализованный, за вычетом
            комиссий. Период: закрытая сделка учитывается по времени закрытия,
            открытая — по времени открытия. Max DD — наибольшая просадка
            накопленного PnL группы от пика, в $ (и в % от пика equity для
            экспериментов и рынков). Long = покупка (B), Short = продажа (S).
          </p>
        </div>
      )}
    </div>
  );
}

export function StatsPage() {
  return (
    <Suspense>
      <StatsDashboard />
    </Suspense>
  );
}
