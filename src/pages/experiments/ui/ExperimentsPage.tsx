"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, Suspense, useMemo } from "react";
import {
  ASSET_GROUP_DESCRIPTION,
  ASSET_GROUPS,
  assetGroupOf,
  DemoMisses,
  DisabledBadge,
  describeRunView,
  type ExperimentSummary,
  enabledVariantsOf,
  formatProfitFactor,
  formatRate,
  formatSignedUsd,
  liveEstimateHint,
  MissingRunNotice,
  pnlTone,
  RunSelect,
  useExperiments,
} from "@/entities/experiment";
import { liveLogsHref, mirrorLogsHref } from "@/entities/log-entry";
import { DemoMirrorToggle } from "@/features/demo-mirror-toggle";
import { ExperimentEnabledSwitch } from "@/features/experiment-toggle";
import {
  cn,
  defineSortTable,
  formatUsd,
  type SavedSort,
  type SortHeadProps,
  useTableSort,
} from "@/shared/lib";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { SortableHead } from "@/shared/ui/SortableHead";
import {
  Table,
  TableBody,
  TableCell,
  TableFrame,
  TableHeader,
  TableRow,
} from "@/shared/ui/Table";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/Tabs";
import { LiveMirrorToggle, LiveTradingStrip } from "@/widgets/live-trading";
import {
  arrangeVariants,
  type ExperimentRowView,
  hideCollapsed,
  isGroupedSort,
  liveKnown,
  SORT_KEYS,
  type SortKey,
  sortExperiments,
} from "../lib/sortExperiments";
import { useCollapsedControls } from "../model/useCollapsedControls";
import {
  MARKET_FILTERS,
  type MarketFilter,
  useExperimentsView,
} from "../model/useExperimentsView";

const SORT_TABLE = defineSortTable("experiments:list", SORT_KEYS);
/** Без сохранённой сортировки — по эксперименту (F01, F02…). */
const DEFAULT_SORT: SavedSort<SortKey> = { key: "id", dir: "asc" };

const MARKET_LABELS: Record<MarketFilter, string> = {
  all: "Все",
  spot: ASSET_GROUPS.spot.code,
  usdm: ASSET_GROUPS.usdm.code,
  coinm: ASSET_GROUPS.coinm.code,
};

const COLUMNS: {
  key: SortKey;
  label: string;
  numeric: boolean;
  description: string;
}[] = [
  {
    key: "enabled",
    label: "Вкл",
    numeric: false,
    description:
      "Включён ли эксперимент сейчас — при любой эпохе в выборе периода. Включённый открывает новые paper-сделки; включение — сразу. Выключенный новых сделок не открывает, а открытые доводит до выхода; выключение — с причиной (окно), контрольный, у которого идут варианты, — только с подтверждением. Тот же тумблер — в /settings и на странице эксперимента.",
  },
  {
    key: "id",
    label: "Эксперимент",
    numeric: false,
    description:
      "Код, название и гипотеза эксперимента. Клик по строке — подробности, конфиг и сделки. При сортировке по этой колонке (и по умолчанию) варианты (↳) стоят под своим контрольным: «вариант A · что изменено»; шеврон у контрольного сворачивает их. При сортировке по другой колонке каждая строка — на своём месте, у варианта метка «вариант A от <контрольный>»; кнопка «Сгруппировать варианты» над таблицей возвращает группы.",
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
    description:
      "Закрытые сделки выбранного периода — эпохи или всех эпох (+ открытые сейчас).",
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
    description: "Наибольшая просадка equity от пика, в % от пика.",
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
      "Переключатель «Выкл · Авто · Вкл» — торгует ли эксперимент и на демо-счёте Binance (demo.binance.com, виртуальные деньги): каждый новый вход повторяется на бирже с тем же объёмом, стопом и тейком. «Авто» — раз в сутки решает автомат по paper-сделкам (≥ 30 сделок со средним R > 0 — включить; средний R последних 30 < 0 или эксперимент выключен — выключить), «Авто · вкл» — сейчас торгует. «Вкл» / «Выкл» — вручную, автомат их не меняет; «Вкл» — с подтверждением.",
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
  {
    key: "demoProfitFactor",
    label: "Демо: Profit factor",
    numeric: true,
    description:
      "Σ прибылей / Σ убытков закрытых демо-сделок с последнего демо-сброса; ∞ — убытков не было.",
  },
  {
    key: "demoMaxDrawdown",
    label: "Демо: Max DD",
    numeric: true,
    description: "Наибольшая просадка демо-equity от пика, % от пика.",
  },
  {
    key: "demoEquity",
    label: "Демо: Equity",
    numeric: true,
    description:
      "Стартовый бюджет эксперимента + PnL демо-сделок с последнего демо-сброса (отдельного демо-капитала у эксперимента нет, демо-счёт общий).",
  },
  {
    key: "live",
    label: "Real: торговля",
    numeric: false,
    description:
      "Переключатель «Реальный счёт» «Выкл · Авто · Вкл · Вкл + автовыкл» — повторяет ли эксперимент свежие входы на торговом субсчёте Binance реальными деньгами. «Авто» — решает автомат: ≥ 30 закрытых демо-сделок со средним R > 0 — включить; средний R последних 30 демо-сделок < 0 или сработал порог — выключить; «Авто · вкл» — сейчас торгует. «Вкл + автовыкл» — включено вручную, приложение выключит по порогам: убыток с момента включения (по умолчанию $15) или серия убыточных сделок (по умолчанию 5). «Вкл» и «Выкл» — вручную, автомат их не меняет. После автовыключения — «Выкл» с причиной и датой, снова включить — только вручную. Лимиты: $10 на сделку (минимум биржи — до $50), не больше 5 позиций на субсчёт, −$15 за сутки у эксперимента → его входы до 00:00 UTC. Всё, кроме «Выкл», — с подтверждением словом «РЕАЛ» и только при годном ключе (карточка «Реальный счёт» в /settings). COIN-M — недоступно.",
  },
  {
    key: "liveTrades",
    label: "Real: сделки",
    numeric: true,
    description:
      "Сделки эксперимента на реальном счёте за всё время (сбросов у реального счёта нет): закрытые (+ открытые сейчас). «отказ» — биржа не приняла вход; «пропуск» — вход не отправлялся: стоп входов, лимит 5 позиций, дневной лимит убытка, мало средств на субсчёте, по монете уже есть реальная позиция, вход не свежий. Значок журнала — причины в /logs. COIN-M на реальном счёте не торгуется.",
  },
  {
    key: "liveWinRate",
    label: "Real: win rate",
    numeric: true,
    description:
      "Доля прибыльных среди закрытых реальных сделок за всё время (сделки без PnL не считаются).",
  },
  {
    key: "livePnl",
    label: "Real: PnL",
    numeric: true,
    description:
      "Реализованный плюс или минус на реальном счёте по эксперименту за всё время, $: по фактическим исполнениям биржи, после комиссий (у демо — без комиссий). «≈» — среди сделок есть оценки по ценам входа и выхода (исполнения не прочитаны) или сделки без PnL; сколько — в подсказке.",
  },
  {
    key: "liveProfitFactor",
    label: "Real: Profit factor",
    numeric: true,
    description:
      "Σ прибылей / Σ убытков закрытых реальных сделок за всё время; ∞ — убытков не было.",
  },
  {
    key: "liveMaxDrawdown",
    label: "Real: Max DD",
    numeric: true,
    description:
      "Наибольшая просадка накопленного реального PnL от пика за всё время, в $ (не в %: капитала на эксперимент у реального счёта нет — деньги общие, $10 на сделку). Сделки — в порядке закрытия, старт — $0.",
  },
  {
    key: "liveEquity",
    label: "Real: Equity",
    numeric: true,
    description:
      "Накопленный реальный PnL эксперимента за всё время, $: бюджета на реальном счёте у эксперимента нет, поэтому старт — $0, а не бюджет paper.",
  },
];

/** Оттенок всех колонок «Демо: …» — ячейки (AC6; пользователь выбрал sky 2026-10-15). */
const DEMO_TONE = "bg-sky-500/[0.06]";
/**
 * Тот же оттенок для липкой шапки — фоновым изображением поверх непрозрачного bg-card шапки.
 * Цвет фона (как в DEMO_TONE) заменил бы bg-card, и строки просвечивали бы при прокрутке.
 */
const DEMO_HEAD_TONE = "bg-linear-to-b from-sky-500/[0.06] to-sky-500/[0.06]";
const isDemoColumn = (key: SortKey) => key.startsWith("demo");
/** Оттенок колонок «Real: …» (spec 0054, AC2: amber) — так же, как у демо: ячейки и шапка фоновым изображением. */
const LIVE_TONE = "bg-amber-500/[0.07]";
const LIVE_HEAD_TONE =
  "bg-linear-to-b from-amber-500/[0.07] to-amber-500/[0.07]";
const isLiveColumn = (key: SortKey) => key.startsWith("live");

function ColumnHead({
  column,
  head,
}: {
  column: (typeof COLUMNS)[number];
  head: SortHeadProps;
}) {
  return (
    <SortableHead
      className={cn(
        column.numeric && "text-right",
        (column.key === "demo" ||
          column.key === "live" ||
          column.key === "enabled") &&
          "text-center",
        isDemoColumn(column.key) && DEMO_HEAD_TONE,
        isLiveColumn(column.key) && LIVE_HEAD_TONE,
      )}
      {...head}
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
      <TableCell className={cn("text-center", DEMO_TONE)}>
        <DemoMirrorToggle experiment={e} demoConfigured={demoConfigured} />
      </TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", DEMO_TONE)}>
        {d.trades || d.rejected || d.skipped ? (
          <>
            {d.closed}
            {d.open > 0 && (
              <span className="text-muted-foreground"> +{d.open}</span>
            )}
            <DemoMisses d={d} logsHref={mirrorLogsHref(e.id)} />
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", DEMO_TONE)}>
        {d.closed ? formatRate(d.wins / d.closed) : "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono font-semibold tabular-nums",
          pnlTone(d.pnl),
          DEMO_TONE,
        )}
      >
        {d.closed ? formatSignedUsd(d.pnl) : "—"}
      </TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", DEMO_TONE)}>
        {d.closed ? formatProfitFactor(d.profitFactor, d.grossProfit) : "—"}
      </TableCell>
      <TableCell
        className={cn(
          "text-right font-mono tabular-nums text-muted-foreground",
          DEMO_TONE,
        )}
      >
        {d.closed ? formatRate(-d.maxDrawdownPct) : "—"}
      </TableCell>
      <TableCell className={cn("text-right font-mono tabular-nums", DEMO_TONE)}>
        {d.closed ? formatUsd(d.equity) : "—"}
      </TableCell>
    </>
  );
}

const COINM_LIVE = "COIN-M на реальном счёте не торгуется";
const LIVE_MISSES_HINT =
  "Отказ — биржа не приняла вход (позиция не открыта). Пропуск — вход на реальном счёте не отправлялся: стоп входов, лимит позиций субсчёта, дневной лимит убытка эксперимента, мало средств на субсчёте, по монете уже есть реальная позиция, минимум биржи или вход не свежий.";

/** Числовая ячейка Real: «—» без закрытых реальных сделок с PnL (у COIN-M — с подсказкой). */
function LiveNumberCell({
  e,
  className,
  title,
  children,
}: {
  e: ExperimentSummary;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  const known = liveKnown(e);
  return (
    <TableCell
      className={cn(
        "text-right font-mono tabular-nums",
        known ? className : "text-muted-foreground",
        LIVE_TONE,
      )}
      title={e.market === "coinm" ? COINM_LIVE : known ? title : undefined}
    >
      {known ? children : "—"}
    </TableCell>
  );
}

/** Раздел Real (spec 0054): переключатель «Реальный счёт» и метрики реальных сделок за всё время. */
function LiveCells({ e }: { e: ExperimentSummary }) {
  const l = e.live;
  const coinm = e.market === "coinm";
  const hint = liveEstimateHint(l) ?? undefined;
  const approx = hint ? "≈ " : "";
  return (
    <>
      <TableCell className={cn("text-center", LIVE_TONE)}>
        <LiveMirrorToggle experiment={e} />
      </TableCell>
      <TableCell
        className={cn("text-right font-mono tabular-nums", LIVE_TONE)}
        title={coinm ? COINM_LIVE : undefined}
      >
        {!coinm && (l.trades || l.rejected || l.skipped) ? (
          <>
            {l.closed}
            {l.open > 0 && (
              <span className="text-muted-foreground"> +{l.open}</span>
            )}
            <DemoMisses
              d={l}
              logsHref={liveLogsHref(e.id)}
              title={LIVE_MISSES_HINT}
            />
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <LiveNumberCell e={e}>{formatRate(l.winRate)}</LiveNumberCell>
      <LiveNumberCell
        e={e}
        className={cn("font-semibold", pnlTone(l.pnl))}
        title={hint}
      >
        {approx}
        {formatSignedUsd(l.pnl)}
      </LiveNumberCell>
      <LiveNumberCell e={e}>
        {formatProfitFactor(l.profitFactor, l.grossProfit)}
      </LiveNumberCell>
      <LiveNumberCell e={e} className="text-muted-foreground">
        {formatUsd(l.maxDrawdown > 0 ? -l.maxDrawdown : 0)}
      </LiveNumberCell>
      <LiveNumberCell e={e} title={hint}>
        {approx}
        {formatSignedUsd(l.pnl)}
      </LiveNumberCell>
    </>
  );
}

const experimentHref = (id: string) => `/experiments/${encodeURIComponent(id)}`;

/** Вариант не под своим контрольным (spec 0052, AC3): «вариант A от F96», id контрольного — ссылка на его страницу. */
function VariantOfBadge({
  letter,
  controlId,
}: {
  letter: string | null;
  controlId: string;
}) {
  return (
    // overflow-visible: рамка фокуса ссылки внутри бейджа не обрезается.
    <Badge
      variant="outline"
      className="overflow-visible font-normal text-muted-foreground"
    >
      вариант {letter} от{" "}
      <Link
        href={experimentHref(controlId)}
        className="font-mono text-foreground underline-offset-4 hover:underline"
      >
        {controlId}
      </Link>
    </Badge>
  );
}

function ExperimentCell({
  row,
  collapsed,
  onToggle,
}: {
  row: ExperimentRowView;
  collapsed: boolean;
  onToggle: (id: string) => void;
}) {
  const { e, variantOf, letter, nested, variants } = row;
  const href = experimentHref(e.id);
  const code = (
    <span className="font-mono text-xs text-muted-foreground">{e.id}</span>
  );
  return (
    <TableCell className={cn("whitespace-normal", nested && "pl-8")}>
      <div className="flex flex-col gap-0.5">
        {/* Код, название и бейджи — всегда в одну строку (spec 0022, решение 4). */}
        <span className="flex items-center gap-2 whitespace-nowrap">
          {variants > 0 && (
            <button
              type="button"
              className="-ml-1 rounded text-muted-foreground hover:text-foreground"
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Показать" : "Скрыть"} варианты ${e.id} (${variants})`}
              title={`Варианты: ${variants}`}
              onClick={() => onToggle(e.id)}
            >
              {collapsed ? (
                <ChevronRight className="size-4" aria-hidden />
              ) : (
                <ChevronDown className="size-4" aria-hidden />
              )}
            </button>
          )}
          {variantOf && !nested ? (
            // Метка — между кодом и названием: в ней своя ссылка, а ссылка в ссылке недопустима.
            <>
              <Link href={href} tabIndex={-1} className="hover:underline">
                {code}
              </Link>
              <VariantOfBadge letter={letter} controlId={variantOf} />
              <Link href={href} className="font-medium hover:underline">
                {e.name}
              </Link>
            </>
          ) : (
            <Link href={href} className="group flex items-center gap-2">
              {nested && (
                <span className="text-muted-foreground" aria-hidden>
                  ↳
                </span>
              )}
              {code}
              <span className="font-medium group-hover:underline">
                {e.name}
              </span>
            </Link>
          )}
          {!e.enabled && <DisabledBadge disabled={e.disabled} />}
        </span>
        {/* contain-inline-size: гипотеза не участвует в ширине колонки, только обрезается многоточием. */}
        <Link
          href={href}
          tabIndex={-1}
          className="line-clamp-1 text-xs text-muted-foreground contain-inline-size"
        >
          {variantOf
            ? `вариант ${letter ?? ""}${e.variantNote ? ` · ${e.variantNote}` : ""}`
            : e.hypothesis}
        </Link>
      </div>
    </TableCell>
  );
}

function ExperimentRow({
  row,
  variants,
  demoConfigured,
  collapsed,
  onToggle,
}: {
  row: ExperimentRowView;
  /** Включённые варианты, если строка — контрольный (окно выключения). */
  variants: readonly string[];
  demoConfigured: boolean;
  collapsed: boolean;
  onToggle: (id: string) => void;
}) {
  const { e } = row;
  const s = e.stats;
  return (
    <TableRow
      className={cn(
        // Выключенный затемнён, кроме ячейки тумблера (первой): иначе тумблер плохо видно (spec 0050).
        !e.enabled && "[&>td:not(:first-child)]:opacity-50",
        row.nested && "bg-muted/30",
      )}
    >
      <TableCell className="text-center">
        <ExperimentEnabledSwitch experiment={e} variants={variants} />
      </TableCell>
      <ExperimentCell row={row} collapsed={collapsed} onToggle={onToggle} />
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
      <LiveCells e={e} />
    </TableRow>
  );
}

/** Название колонки — то же, что в заголовке таблицы. */
const columnLabel = (key: SortKey) =>
  COLUMNS.find((c) => c.key === key)?.label ?? key;

/** Плоский вид (spec 0052, AC5): почему варианты не под контрольным и возврат к группам — сброс сортировки. */
function FlatSortNotice({
  column,
  onGroup,
}: {
  column: string;
  onGroup: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
      <p>Сортировка по «{column}»: варианты A/B стоят на своих местах</p>
      <Button type="button" variant="outline" size="sm" onClick={onGroup}>
        Сгруппировать варианты
      </Button>
    </div>
  );
}

function ExperimentsDashboard() {
  const [{ market, run }, setView] = useExperimentsView();
  const { data, isPending, error, isPlaceholderData } = useExperiments(run);
  const { sort, head } = useTableSort(SORT_TABLE, DEFAULT_SORT);
  const { collapsed, toggle } = useCollapsedControls();
  const grouped = isGroupedSort(sort.key);
  const rows = useMemo(() => {
    const all = data?.experiments ?? [];
    return arrangeVariants(
      sortExperiments(all, market, sort.key, sort.dir),
      all,
      grouped,
    );
  }, [data, market, sort, grouped]);
  const shown = hideCollapsed(rows, collapsed);
  const total = data?.experiments.reduce((n, e) => n + e.stats.trades, 0) ?? 0;
  const current = !!data && data.scope === data.runs[0]?.id;

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
            {data && ` ${describeRunView(data)}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Link
            href="/stats"
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Разрезы по монетам и направлениям →
          </Link>
          {data && (
            <RunSelect view={data} onChange={(r) => setView({ run: r })} />
          )}
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
      {data && (
        <MissingRunNotice view={data} onReset={() => setView({ run: null })} />
      )}
      {data && <LiveTradingStrip />}

      {data && total === 0 && (
        <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {!current
            ? "За выбранный период сделок нет."
            : data.engineEnabled
              ? "Движок включён, сделок пока нет: стратегии ждут закрытия свечи и сигнала."
              : "Движок выключен — сделок нет. Включите «Автоторговлю» в шапке или в /settings, чтобы эксперименты начали торговать на бумаге."}
        </p>
      )}

      {data && (
        <div className="flex flex-col gap-2">
          {!grouped && (
            <FlatSortNotice
              column={columnLabel(sort.key)}
              onGroup={head(sort.key).onReset}
            />
          )}
          <TableFrame
            className={cn(
              "transition-opacity",
              isPlaceholderData && "opacity-60",
            )}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  {COLUMNS.map((c) => (
                    <ColumnHead key={c.key} column={c} head={head(c.key)} />
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <ExperimentRow
                    key={r.e.id}
                    row={r}
                    variants={enabledVariantsOf(data.experiments, r.e.id)}
                    demoConfigured={data.demoConfigured}
                    collapsed={collapsed.has(r.e.id)}
                    onToggle={toggle}
                  />
                ))}
              </TableBody>
            </Table>
          </TableFrame>
        </div>
      )}

      {data && (
        <p className="text-xs text-muted-foreground">
          Показано: {describeRunView(data)}.{" "}
          {data.scope === "all"
            ? "Paper-колонки — все сделки эксперимента с первой эпохи (отдельные сбросы эксперимента и группы историю не отсекают), демо-колонки — все демо-зеркала. "
            : current
              ? "Демо-колонки — с последнего демо-сброса. "
              : "Paper и демо — сделки этой эпохи. "}
          Real-колонки — все сделки на реальном счёте (за всё время, PnL по
          исполнениям с комиссиями, Max DD и Equity — в $). Сделки — закрытые (+
          открытые). PnL — реализованный, за вычетом комиссий. Equity =
          стартовый капитал (текущий бюджет эксперимента) + PnL. Max DD —
          наибольшая просадка equity от пика.
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
