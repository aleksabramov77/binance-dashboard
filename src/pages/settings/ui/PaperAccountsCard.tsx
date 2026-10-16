"use client";

import {
  assetGroupOf,
  DisabledBadge,
  enabledVariantsOf,
  formatSignedUsd,
  type LabSettings,
  pnlTone,
  useResetExperimentPaper,
} from "@/entities/experiment";
import { ExperimentEnabledSwitch } from "@/features/experiment-toggle";
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
} from "@/shared/ui/Card";
import { ConfirmAction } from "@/shared/ui/ConfirmAction";
import { SortableHead } from "@/shared/ui/SortableHead";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/Table";

type Experiment = LabSettings["experiments"][number];

const SORT_KEYS = [
  "id",
  "name",
  "enabled",
  "equity",
  "pnl",
  "trades",
  "resetAt",
] as const;
type SortKey = (typeof SORT_KEYS)[number];
const SORT_TABLE = defineSortTable("settings:paper", SORT_KEYS);

const SORT_VALUE: Record<SortKey, (e: Experiment) => SortValue> = {
  id: (e) => e.id,
  name: (e) => e.name,
  enabled: (e) => e.enabled,
  equity: (e) => e.paper.equity,
  pnl: (e) => (e.paper.closed ? e.paper.pnl : null),
  trades: (e) => e.paper.closed + e.paper.open,
  resetAt: (e) => (e.paper.resetAt ? Date.parse(e.paper.resetAt) : null),
};

const HELP: Record<SortKey, string> = {
  id: "Код эксперимента: S — Spot (только покупки), F — USDⓈ-M (лонг и шорт).",
  name: "Название и гипотеза эксперимента.",
  enabled:
    "Включённый эксперимент открывает новые paper-сделки. Выключенный новых не открывает, а открытые доводит до выхода. Выключение — с причиной (окно); контрольный, у которого идут варианты, — только с подтверждением.",
  equity:
    "Paper-капитал эксперимента: стартовый бюджет + реализованный PnL с начала эпохи или с отдельного сброса.",
  pnl: "Реализованный paper-PnL после комиссий с начала эпохи или с отдельного сброса.",
  trades: "Paper-сделки в учёте: закрытые (+ открытые сейчас).",
  resetAt:
    "Когда paper-капитал эксперимента сбрасывали отдельно. «—» — учёт идёт с начала эпохи.",
};

function ResetPaperButton({ e }: { e: Experiment }) {
  const reset = useResetExperimentPaper();
  return (
    <ConfirmAction
      label="Сбросить"
      variant="outline"
      title={`Сбросить paper-капитал ${e.id}?`}
      description={e.name}
      confirmLabel="Сбросить paper"
      pending={reset.isPending}
      error={reset.error?.message}
      onOpen={() => reset.reset()}
      onConfirm={(close) =>
        reset.mutate({ id: e.id }, { onSuccess: () => close() })
      }
    >
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Открытые paper-сделки {e.id} ({e.paper.open}) закроются по последней
          цене с причиной «вручную».
        </li>
        <li>
          Капитал начнётся заново: {formatUsd(e.initialBudget)}, PnL и
          статистика эксперимента — с нуля. Старые сделки остаются в истории.
        </li>
        <li>
          Другие эксперименты, эпоха и демо-счёт не меняются (демо-позиции этих
          сделок зеркало закроет вместе с ними).
        </li>
      </ul>
    </ConfirmAction>
  );
}

/** Paper-счета экспериментов: капитал, вкл/выкл и отдельный сброс каждого. */
export function PaperAccountsCard({
  experiments,
}: {
  experiments: LabSettings["experiments"];
}) {
  const enabled = experiments.filter((e) => e.enabled).length;
  const { sort, head } = useTableSort(SORT_TABLE);
  const rows = sort
    ? sortRows(experiments, SORT_VALUE[sort.key], sort.dir)
    : experiments;

  return (
    <Card className="w-fit max-w-full min-w-0">
      <CardHeader>
        <CardTitle>Paper-счета экспериментов</CardTitle>
        <CardDescription className="contain-inline-size">
          Симуляция на бумаге: у каждого эксперимента свой капитал. Включено{" "}
          {enabled} из {experiments.length}. «Сбросить» в строке — начать учёт
          одного эксперимента заново.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
                {...head("enabled")}
                description={HELP.enabled}
              >
                Включён
              </SortableHead>
              <SortableHead
                className="text-right"
                {...head("equity")}
                description={HELP.equity}
              >
                Капитал
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
                {...head("trades")}
                description={HELP.trades}
              >
                Сделки
              </SortableHead>
              <SortableHead {...head("resetAt")} description={HELP.resetAt}>
                Сброшен
              </SortableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono">{e.id}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="font-medium whitespace-nowrap">
                    {e.name}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {assetGroupOf(e.market).label}
                    </span>
                    {e.parentId && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {" "}
                        · вариант {e.parentId}
                      </span>
                    )}{" "}
                    {!e.enabled && <DisabledBadge disabled={e.disabled} />}
                  </div>
                  {/* contain-inline-size: гипотеза не участвует в ширине колонки, только обрезается многоточием. */}
                  <div className="line-clamp-1 text-xs text-muted-foreground contain-inline-size">
                    {e.hypothesis}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <ExperimentEnabledSwitch
                    experiment={e}
                    variants={enabledVariantsOf(experiments, e.id)}
                  />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatUsd(e.paper.equity)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono tabular-nums",
                    pnlTone(e.paper.pnl),
                  )}
                >
                  {e.paper.closed ? formatSignedUsd(e.paper.pnl) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {e.paper.closed}
                  {e.paper.open > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      +{e.paper.open}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {e.paper.resetAt ? formatDateTime(e.paper.resetAt) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <ResetPaperButton e={e} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
