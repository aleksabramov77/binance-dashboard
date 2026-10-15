"use client";

import {
  DemoMisses,
  formatRate,
  formatSignedUsd,
  type LabSettings,
  pnlTone,
  useResetDemo,
} from "@/entities/experiment";
import { mirrorLogsHref } from "@/entities/log-entry";
import { DemoMirrorToggle } from "@/features/demo-mirror-toggle";
import { DEMO_WALLET_URL } from "@/shared/config";
import {
  cn,
  defineSortTable,
  formatDateTime,
  formatUsd,
  type SortValue,
  sortRows,
  useTableSort,
} from "@/shared/lib";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import { SortableHead } from "@/shared/ui/sortable-head";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

type Experiment = LabSettings["experiments"][number];

const SORT_KEYS = [
  "id",
  "name",
  "trading",
  "trades",
  "winRate",
  "pnl",
  "resetAt",
] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SORT_TABLE = defineSortTable("settings:demo", SORT_KEYS);

const SORT_VALUE: Record<SortKey, (e: Experiment) => SortValue> = {
  id: (e) => e.id,
  name: (e) => e.name,
  trading: (e) => e.demoMirror,
  trades: (e) => e.demo.trades || null,
  winRate: (e) => (e.demo.closed ? e.demo.wins / e.demo.closed : null),
  pnl: (e) => (e.demo.closed ? e.demo.pnl : null),
  resetAt: (e) => (e.demo.resetAt ? Date.parse(e.demo.resetAt) : null),
};

const HELP: Record<SortKey, string> = {
  id: "Код эксперимента.",
  name: "Название эксперимента.",
  trading:
    "Галочка — новые входы эксперимента повторяются на демо-счёте Binance (виртуальные деньги). Включение и выключение — с подтверждением.",
  trades:
    "Сделки на демо-счёте с последнего демо-сброса: закрытые (+ открытые сейчас); «отказ» — биржа не приняла вход, «пропуск» — зеркало само не повторяло вход (встречная позиция без Hedge mode, монеты нет на демо, вход старше 10 минут).",
  winRate: "Доля прибыльных среди закрытых демо-сделок.",
  pnl: "Плюс или минус на демо-счёте по эксперименту с последнего демо-сброса, $, без комиссий.",
  resetAt:
    "Когда демо-статистику эксперимента сбрасывали. «—» — с первой демо-сделки.",
};

function ResetDemoButton({ e }: { e: Experiment }) {
  const reset = useResetDemo();
  return (
    <ConfirmAction
      label="Сбросить"
      variant="outline"
      title={`Сбросить демо для ${e.id}?`}
      description={e.name}
      confirmLabel="Сбросить демо"
      pending={reset.isPending}
      error={reset.error?.message}
      onOpen={() => reset.reset()}
      onConfirm={(close) =>
        reset.mutate({ id: e.id }, { onSuccess: () => close() })
      }
    >
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Открытые позиции {e.id} на демо-счёте ({e.demo.open}) закроются по
          рынку, их TP/SL снимутся.
        </li>
        <li>Демо-статистика эксперимента (сделки, win rate, PnL) — с нуля.</li>
        <li>
          Галочка «торговля» и paper-счёт не меняются: новые входы продолжат
          зеркалиться.
        </li>
      </ul>
    </ConfirmAction>
  );
}

/** Демо-счёт Binance: балансы, торговля экспериментов, их демо-результат и сбросы. */
export function DemoAccountsCard({ settings }: { settings: LabSettings }) {
  const { experiments, demoBalances, demoConfigured } = settings;
  const resetAll = useResetDemo();
  const { sort, head } = useTableSort(SORT_TABLE);
  const rows = sort
    ? sortRows(experiments, SORT_VALUE[sort.key], sort.dir)
    : experiments;
  const trading = experiments.filter((e) => e.demoMirror).length;
  const open = experiments.reduce((n, e) => n + e.demo.open, 0);
  const pnl = experiments.reduce((n, e) => n + e.demo.pnl, 0);

  return (
    <Card className="w-fit max-w-full min-w-0">
      <CardHeader>
        <CardTitle>Демо-счёт Binance</CardTitle>
        <CardDescription className="contain-inline-size">
          Реальные ордера на demo.binance.com с виртуальными деньгами. Торгуют{" "}
          {trading} из {experiments.length} экспериментов; открыто позиций:{" "}
          {open}; итог по закрытым:{" "}
          <span className={cn("font-medium", pnlTone(pnl))}>
            {formatSignedUsd(pnl)}
          </span>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!demoConfigured && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm contain-inline-size">
            На сервере не задан ключ Binance Demo (BINANCE_DEMO_API_KEY /
            SECRET) — торговля на демо-счёте не работает.
          </p>
        )}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Свободно Spot</dt>
            <dd className="font-mono tabular-nums">
              {demoBalances ? formatUsd(demoBalances.spot) : "—"}
            </dd>
            <dt className="text-muted-foreground">Свободно USDⓈ-M</dt>
            <dd className="font-mono tabular-nums">
              {demoBalances ? formatUsd(demoBalances.futures) : "—"}
            </dd>
          </dl>
          <ConfirmAction
            label="Сбросить всё Demo"
            title="Сбросить демо всех экспериментов?"
            confirmLabel="Сбросить всё Demo"
            pending={resetAll.isPending}
            error={resetAll.error?.message}
            onOpen={() => resetAll.reset()}
            onConfirm={(close) =>
              resetAll.mutate({ id: null }, { onSuccess: () => close() })
            }
          >
            <ul className="list-disc space-y-1 pl-5">
              <li>
                Все открытые позиции зеркала на демо-счёте ({open}) закроются по
                рынку, их TP/SL снимутся.
              </li>
              <li>Демо-статистика всех экспериментов — с нуля.</li>
              <li>
                Paper-счета и галочки «торговля» не меняются. Баланс демо-счёта
                приложение сбросить не может (у Binance нет такого API): чтобы
                начать и баланс с нуля, нажмите «Сброс» на сайте Binance:{" "}
                <a
                  href={DEMO_WALLET_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  Сбросить баланс на demo.binance.com
                </a>
                .
              </li>
            </ul>
          </ConfirmAction>
        </div>
        {resetAll.data && (
          <output className="text-sm text-muted-foreground contain-inline-size">
            Демо сброшено: закрыто позиций {resetAll.data.closed}
            {resetAll.data.failed > 0 &&
              `, не закрылись ${resetAll.data.failed} — зеркало повторит попытку`}
            .
          </output>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                className="w-16"
                {...head("id")}
                description={HELP.id}
              >
                ID
              </SortableHead>
              <SortableHead {...head("name")} description={HELP.name}>
                Эксперимент
              </SortableHead>
              <SortableHead
                className="w-24 text-center"
                {...head("trading")}
                description={HELP.trading}
              >
                Торговля
              </SortableHead>
              <SortableHead
                className="text-right"
                {...head("trades")}
                description={HELP.trades}
              >
                Сделки
              </SortableHead>
              <SortableHead
                className="text-right"
                {...head("winRate")}
                description={HELP.winRate}
              >
                Win rate
              </SortableHead>
              <SortableHead
                className="text-right"
                {...head("pnl")}
                description={HELP.pnl}
              >
                PnL
              </SortableHead>
              <SortableHead {...head("resetAt")} description={HELP.resetAt}>
                Сброшен
              </SortableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => {
              const d = e.demo;
              return (
                <TableRow key={e.id}>
                  <TableCell className="font-mono">{e.id}</TableCell>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell className="text-center">
                    <DemoMirrorToggle
                      experiment={e}
                      demoConfigured={demoConfigured}
                    />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {d.closed}
                    {d.open > 0 && (
                      <span className="text-muted-foreground"> +{d.open}</span>
                    )}
                    <DemoMisses d={d} logsHref={mirrorLogsHref(e.id)} />
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
                  <TableCell className="text-sm text-muted-foreground">
                    {d.resetAt ? formatDateTime(d.resetAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ResetDemoButton e={e} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
