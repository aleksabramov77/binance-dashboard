"use client";

import Link from "next/link";
import {
  assetGroupOf,
  CONFIG_SAME_TEXT,
  DisabledBadge,
  diffExperimentConfig,
  type Experiment,
  type FamilyMember,
  formatProfitFactor,
  formatR,
  formatRate,
  formatSignedUsd,
  pnlTone,
} from "@/entities/experiment";
import { cn } from "@/shared/lib";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";

// Контрольный и варианты на странице эксперимента (spec 0046, AC9): у варианта — что изменено, отличия настроек и
// метрики рядом с контрольным; у контрольного — список вариантов с теми же метриками. Период — как у страницы.

const memberTitle = (m: FamilyMember) =>
  m.letter ? `Вариант ${m.letter}` : "Контрольный";

/** Сделки, win rate, средний R, PnL, profit factor участников группы за выбранный период. */
function FamilyMetrics({
  members,
  current,
  runQuery,
}: {
  members: FamilyMember[];
  current: string;
  /** `?run=…` выбранного периода — переход к соседу по группе его не сбрасывает; "" — текущая эпоха. */
  runQuery: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Эксперимент</TableHead>
          <TableHead className="text-right">Сделки</TableHead>
          <TableHead className="text-right">Win rate</TableHead>
          <TableHead className="text-right">Средний R</TableHead>
          <TableHead className="text-right">PnL</TableHead>
          <TableHead className="text-right">Profit factor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => {
          const s = m.stats;
          return (
            <TableRow
              key={m.id}
              className={cn(m.id === current && "bg-muted/40")}
            >
              <TableCell className="whitespace-normal">
                <span className="flex flex-wrap items-center gap-2">
                  {m.id === current ? (
                    <span className="font-mono text-xs">{m.id}</span>
                  ) : (
                    <Link
                      href={`/experiments/${encodeURIComponent(m.id)}${runQuery}`}
                      className="font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {m.id}
                    </Link>
                  )}
                  <span className="text-sm">{memberTitle(m)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {assetGroupOf(m.market).code}
                  </span>
                  {!m.enabled && <DisabledBadge disabled={m.disabled} />}
                </span>
                {m.variantNote && (
                  <span className="block text-xs text-muted-foreground">
                    {m.variantNote}
                  </span>
                )}
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
              <TableCell className="text-right font-mono tabular-nums">
                {formatR(s.avgR)}
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
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** Отличия настроек варианта от контрольного: «настройка · у контрольного · у варианта». */
function ConfigDiff({
  control,
  variant,
}: {
  control: FamilyMember;
  variant: Pick<Experiment, "market" | "config">;
}) {
  const lines = diffExperimentConfig(control, variant);
  if (lines.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Отличия настроек: {CONFIG_SAME_TEXT}.
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Настройка</TableHead>
          <TableHead>У {control.id}</TableHead>
          <TableHead>У варианта</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l) => (
          <TableRow key={l.path}>
            <TableCell className="font-mono text-xs">{l.path}</TableCell>
            <TableCell className="font-mono text-xs whitespace-normal break-all">
              {l.control ?? "—"}
            </TableCell>
            <TableCell className="font-mono text-xs whitespace-normal break-all">
              {l.variant ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function VariantFamily({
  experiment,
  family,
  period,
  runQuery,
}: {
  experiment: Experiment;
  family: { control: FamilyMember; variants: FamilyMember[] };
  /** Подпись периода метрик: «Эпоха №2 (текущая) с …», «Все эпохи …». */
  period: string;
  /** `?run=…` выбранного периода для ссылок на контрольный и варианты; "" — текущая эпоха. */
  runQuery: string;
}) {
  const { control, variants } = family;
  const self = variants.find((v) => v.id === experiment.id);

  if (self)
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            Вариант {self.letter} от{" "}
            <Link
              href={`/experiments/${encodeURIComponent(control.id)}${runQuery}`}
              className="underline-offset-4 hover:underline"
            >
              {control.id} · {control.name}
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm">
            <span className="text-muted-foreground">Что изменено: </span>
            {self.variantNote ?? "не описано"}
          </p>
          <ConfigDiff control={control} variant={experiment} />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">
              Сравнение с контрольным · {period}
            </span>
            <FamilyMetrics
              runQuery={runQuery}
              members={[control, self]}
              current={experiment.id}
            />
          </div>
        </CardContent>
      </Card>
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Варианты ({variants.length})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">
          Контрольный и его варианты рядом · {period}
        </span>
        <FamilyMetrics
          runQuery={runQuery}
          members={[control, ...variants]}
          current={experiment.id}
        />
      </CardContent>
    </Card>
  );
}
