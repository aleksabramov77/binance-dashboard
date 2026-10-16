"use client";

import { useEffect, useRef } from "react";
import {
  ASSET_GROUPS,
  type LabSettings,
  MARKETS,
  type Market,
  useResetGroup,
} from "@/entities/experiment";
import { DEMO_WALLET_URL } from "@/shared/config";
import { formatUsd } from "@/shared/lib";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { ConfirmAction } from "@/shared/ui/confirm-action";
import {
  Table,
  TableBody,
  TableCell,
  TableFrame,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

// «Сбросы по группам» (spec 0038): Paper или Demo одной группы активов — «эра группы» без новой эпохи.
// Ссылка «Сбросы →» из шапки ведёт сюда (/settings#groups).

const ANCHOR = "groups";

interface GroupRow {
  market: Market;
  code: string;
  label: string;
  demoBlocked: string | null;
  experiments: number;
  paperOpen: number;
  demoOpen: number;
}

function groupRows(settings: LabSettings): GroupRow[] {
  return MARKETS.map((market) => {
    const list = settings.experiments.filter((e) => e.market === market);
    const group = ASSET_GROUPS[market];
    // Число экспериментов — все строки группы в БД, как их сбрасывает resetGroupRun (в т.ч. не прочитанные в сводку).
    const budget = settings.groupBudgets.find((g) => g.market === market);
    return {
      market,
      code: group.code,
      label: group.label,
      demoBlocked: group.demoMirrorBlocked,
      experiments: budget?.experiments ?? list.length,
      paperOpen: list.reduce((n, e) => n + e.paper.open, 0),
      demoOpen: list.reduce((n, e) => n + e.demo.open, 0),
    };
  });
}

type ResetMutation = ReturnType<typeof useResetGroup>;

function ResetPaperButton({
  row,
  settings,
  reset,
}: {
  row: GroupRow;
  settings: LabSettings;
  reset: ResetMutation;
}) {
  const budget = settings.nextBudget;
  return (
    <ConfirmAction
      label="Сбросить Paper"
      variant="outline"
      title={`Сбросить Paper группы ${row.code}?`}
      description={`${row.label}: ${row.experiments} экспериментов, включая выключенные`}
      confirmLabel="Сбросить Paper группы"
      disabled={row.experiments === 0}
      pending={reset.isPending}
      error={reset.error?.message}
      onOpen={() => reset.reset()}
      onConfirm={(close) =>
        reset.mutate(
          { market: row.market, account: "paper" },
          { onSuccess: () => close() },
        )
      }
    >
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Открытые paper-сделки группы ({row.paperOpen}) закроются по последней
          цене с причиной «manual»; если цены нет — по цене входа с PnL 0.
        </li>
        <li>
          Учёт {row.experiments} экспериментов группы начнётся заново с бюджета{" "}
          {formatUsd(budget)} каждый: Paper {row.code} в шапке станет{" "}
          {formatUsd(row.experiments * budget)}.
        </li>
        <li>
          Эпоха №{settings.epoch.id} не меняется, другие группы — тоже. Старые
          сделки остаются в истории.
        </li>
        {!row.demoBlocked && (
          <li>Демо-позиции этих сделок закроет зеркало в течение минуты.</li>
        )}
      </ul>
    </ConfirmAction>
  );
}

function ResetDemoButton({
  row,
  reset,
}: {
  row: GroupRow;
  reset: ResetMutation;
}) {
  if (row.demoBlocked)
    return (
      // У disabled-кнопки нет событий мыши — подсказку показывает обёртка.
      <span title={row.demoBlocked} className="inline-flex">
        <Button variant="outline" size="sm" disabled>
          Сбросить Demo
        </Button>
      </span>
    );
  return (
    <ConfirmAction
      label="Сбросить Demo"
      variant="outline"
      title={`Сбросить Demo группы ${row.code}?`}
      description={`${row.label}: ${row.experiments} экспериментов, включая выключенные`}
      confirmLabel="Сбросить Demo группы"
      disabled={row.experiments === 0}
      pending={reset.isPending}
      error={reset.error?.message}
      onOpen={() => reset.reset()}
      onConfirm={(close) =>
        reset.mutate(
          { market: row.market, account: "demo" },
          { onSuccess: () => close() },
        )
      }
    >
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Открытые демо-позиции экспериментов группы ({row.demoOpen}) закроются
          по рынку, их TP/SL снимутся.
        </li>
        <li>
          Демо-статистика {row.experiments} экспериментов группы (сделки, win
          rate, PnL) начнётся заново.
        </li>
        <li>
          Paper-счета и галочки «торговля» не меняются, другие группы — тоже.
        </li>
        <li>
          Баланс на Binance не меняется: сбросить его можно только на{" "}
          <a
            href={DEMO_WALLET_URL}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-4"
          >
            demo.binance.com
          </a>
          , и там сбрасывается весь демо-счёт, а не группа.
        </li>
      </ul>
    </ConfirmAction>
  );
}

/** Сбросы по группам активов: по каждой группе — эксперименты, открытые сделки и позиции, две кнопки сброса. */
export function GroupResetsCard({ settings }: { settings: LabSettings }) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = groupRows(settings);
  // Одна мутация на карточку: сбросы групп идут по одному, итог последнего — под таблицей.
  const reset = useResetGroup();
  const done = reset.data;

  // Карточка рендерится после загрузки настроек — браузер к якорю #groups ещё не прокрутил.
  useEffect(() => {
    if (window.location.hash === `#${ANCHOR}`)
      ref.current?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <Card
      id={ANCHOR}
      ref={ref}
      className="w-fit max-w-full min-w-0 scroll-mt-4"
    >
      <CardHeader>
        <CardTitle>Сбросы по группам</CardTitle>
        <CardDescription className="contain-inline-size">
          Сброс одной группы активов — «эра группы»: эпоха №{settings.epoch.id}{" "}
          и другие группы не меняются. Paper — учёт экспериментов группы с
          бюджета {formatUsd(settings.nextBudget)}; Demo — демо-позиции и
          демо-статистика экспериментов группы.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <TableFrame>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Группа</TableHead>
                <TableHead
                  className="text-right"
                  title="Все эксперименты группы, включая выключенные"
                >
                  Экспериментов
                </TableHead>
                <TableHead
                  className="text-right"
                  title="Открытые paper-сделки группы в текущей эпохе"
                >
                  Paper-сделок
                </TableHead>
                <TableHead
                  className="text-right"
                  title="Открытые позиции зеркала на демо-счёте Binance"
                >
                  Демо-позиций
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.market}>
                  <TableCell>
                    <span className="font-mono">{row.code}</span>{" "}
                    <span className="text-muted-foreground">{row.label}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.experiments}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.paperOpen}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {row.demoBlocked ? "—" : row.demoOpen}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <ResetPaperButton
                        row={row}
                        settings={settings}
                        reset={reset}
                      />
                      <ResetDemoButton row={row} reset={reset} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableFrame>
        {done && reset.variables && (
          <output className="text-sm text-muted-foreground contain-inline-size">
            {ASSET_GROUPS[reset.variables.market].code}:{" "}
            {done.account === "paper"
              ? `Paper сброшен у ${done.experiments} экспериментов, закрыто сделок ${done.closed}${done.closedWithoutPrice ? ` (без цены, по цене входа: ${done.closedWithoutPrice})` : ""}.`
              : `Demo сброшено у ${done.experiments} экспериментов, закрыто позиций ${done.closed}${done.failed ? `, не закрылись ${done.failed} — зеркало повторит попытку` : ""}.`}
          </output>
        )}
      </CardContent>
    </Card>
  );
}
