"use client";

import {
  type LabSettings,
  useSetExperimentEnabled,
} from "@/entities/experiment";
import { DemoMirrorToggle } from "@/features/demo-mirror-toggle";
import { sortRows, useTableSort } from "@/shared/lib";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { SortableHead } from "@/shared/ui/sortable-head";
import { Switch } from "@/shared/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

const MARKET_LABEL = { spot: "Spot", futures: "Futures" } as const;

const SORT_KEYS = ["id", "market", "name", "enabled", "demoMirror"] as const;
type Experiment = LabSettings["experiments"][number];
const HELP: Record<(typeof SORT_KEYS)[number], string> = {
  id: "Код эксперимента: S — Spot (только покупки), F — Futures (лонг и шорт).",
  market:
    "Рынок Binance, на котором эксперимент торгует на бумаге: Spot или USDⓈ-M Futures.",
  name: "Название и гипотеза: что проверяет эксперимент и по каким правилам входит и выходит.",
  enabled:
    "Включённый эксперимент открывает новые paper-сделки. Выключенный новых не открывает, а открытые доводит до выхода.",
  demoMirror:
    "Отмеченный эксперимент повторяет новые paper-входы в Binance Demo Trading (виртуальные деньги) с теми же SL/TP и объёмом. Демо-позиция закрывается вместе с paper-сделкой. Снятая галочка не закрывает уже открытые зеркала.",
};

const SORT_VALUE: Record<
  (typeof SORT_KEYS)[number],
  (e: Experiment) => string | boolean
> = {
  id: (e) => e.id,
  market: (e) => MARKET_LABEL[e.market],
  name: (e) => e.name,
  enabled: (e) => e.enabled,
  demoMirror: (e) => e.demoMirror,
};

/** Список экспериментов: вкл/выкл каждого и отметка demo-зеркала (spec 008). */
export function ExperimentsCard({
  experiments,
  demoConfigured,
}: {
  experiments: LabSettings["experiments"];
  demoConfigured: boolean;
}) {
  const toggle = useSetExperimentEnabled();
  const enabled = experiments.filter((e) => e.enabled).length;
  const mirrored = experiments.filter((e) => e.demoMirror).length;
  const { sort, head } = useTableSort("expSort", SORT_KEYS);
  const rows = sort
    ? sortRows(experiments, SORT_VALUE[sort.key], sort.dir)
    : experiments;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Эксперименты</CardTitle>
        <CardDescription>
          Включено {enabled} из {experiments.length}. Выключенный эксперимент не
          открывает новые сделки; уже открытые доводятся до выхода. В Binance
          Demo зеркалится: {mirrored}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!demoConfigured && (
          <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            На сервере не задан ключ Binance Demo (BINANCE_DEMO_API_KEY /
            SECRET) — отмеченные эксперименты не будут зеркалиться, пока ключ не
            добавлен.
          </p>
        )}
        {toggle.error && (
          <p className="mb-3 text-sm text-destructive">
            {toggle.error.message}
          </p>
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
              <SortableHead
                className="w-20"
                {...head("market")}
                description={HELP.market}
              >
                Рынок
              </SortableHead>
              <SortableHead {...head("name")} description={HELP.name}>
                Суть
              </SortableHead>
              <SortableHead
                className="w-24 text-center"
                {...head("enabled")}
                description={HELP.enabled}
              >
                Включён
              </SortableHead>
              <SortableHead
                className="w-36 text-center"
                {...head("demoMirror")}
                description={HELP.demoMirror}
              >
                Демо-счёт
              </SortableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="font-mono">{e.id}</TableCell>
                <TableCell>{MARKET_LABEL[e.market]}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.hypothesis}
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    checked={e.enabled}
                    disabled={toggle.isPending && toggle.variables?.id === e.id}
                    aria-label={`Эксперимент ${e.id}`}
                    onCheckedChange={(checked) =>
                      toggle.mutate({ id: e.id, enabled: checked })
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <DemoMirrorToggle
                    experiment={e}
                    demoConfigured={demoConfigured}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
