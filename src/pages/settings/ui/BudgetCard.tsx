"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import {
  ASSET_GROUPS,
  type BudgetForm,
  budgetFormSchema,
  type LabSettings,
  MAX_INITIAL_BUDGET,
  MIN_INITIAL_BUDGET,
  useSetNextBudget,
} from "@/entities/experiment";
import { formatUsd } from "@/shared/lib";
import { Button } from "@/shared/ui/Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/Card";
import { Input } from "@/shared/ui/Input";

type GroupBudget = LabSettings["groupBudgets"][number];

/** «SPOT 10 000 $»; разные бюджеты внутри группы — диапазоном. */
const formatGroupBudget = (g: GroupBudget) =>
  `${ASSET_GROUPS[g.market].code} ${g.min === g.max ? formatUsd(g.min) : `${formatUsd(g.min)}–${formatUsd(g.max)}`}`;

/** Стартовый бюджет на эксперимент: сохраняется сразу, к экспериментам применяется при сбросе (всех или группы). */
export function BudgetCard({ settings }: { settings: LabSettings }) {
  const inputId = useId();
  const save = useSetNextBudget();
  const form = useForm<BudgetForm>({
    resolver: zodResolver(budgetFormSchema),
    defaultValues: { initialBudget: settings.nextBudget },
  });
  const { reset } = form;
  useEffect(() => {
    reset({ initialBudget: settings.nextBudget });
  }, [reset, settings.nextBudget]);

  const error = form.formState.errors.initialBudget?.message;
  const groups = settings.groupBudgets.filter((g) => g.experiments > 0);
  // Ждёт сброса, если хоть у одной группы бюджет экспериментов не равен сохранённому.
  const pending = groups.some(
    (g) => g.min !== settings.nextBudget || g.max !== settings.nextBudget,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Стартовый бюджет</CardTitle>
        <CardDescription>
          На каждый эксперимент, USD. Объём каждой сделки — $50.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={form.handleSubmit((values) => save.mutate(values))}
        >
          <label htmlFor={inputId} className="flex flex-col gap-1 text-sm">
            Бюджет следующей эпохи
            <Input
              id={inputId}
              type="number"
              inputMode="numeric"
              step={100}
              min={MIN_INITIAL_BUDGET}
              max={MAX_INITIAL_BUDGET}
              aria-invalid={Boolean(error)}
              {...form.register("initialBudget", { valueAsNumber: true })}
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {save.error && (
            <p className="text-sm text-destructive">{save.error.message}</p>
          )}
          <p className="text-sm text-muted-foreground">
            Сейчас на эксперимент:{" "}
            {groups.map(formatGroupBudget).join(" · ") || "—"}. Сохранённый
            бюджет применяется при сбросе: «Сбросить все Paper» — всем
            экспериментам (новая эпоха), «Сбросить Paper» группы — экспериментам
            этой группы.
            {pending &&
              ` Сохранено: ${formatUsd(settings.nextBudget)} — ждёт сброса.`}
          </p>
          <Button
            type="submit"
            className="self-start"
            disabled={save.isPending || !form.formState.isDirty}
          >
            {save.isPending ? "Сохраняю…" : "Сохранить"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
