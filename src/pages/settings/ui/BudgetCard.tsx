"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId } from "react";
import { useForm } from "react-hook-form";
import {
  type BudgetForm,
  budgetFormSchema,
  type LabSettings,
  MAX_INITIAL_BUDGET,
  MIN_INITIAL_BUDGET,
  useSetNextBudget,
} from "@/entities/experiment";
import { formatUsd } from "@/shared/lib";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";

/** Стартовый бюджет на эксперимент: сохраняется сразу, к экспериментам применяется при сбросе. */
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
  const pending = settings.nextBudget !== settings.currentBudget;

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
            Текущая эпоха идёт с бюджетом {formatUsd(settings.currentBudget)}.
            Изменение вступит в силу после сброса тестовых капиталов — с новой
            эпохи.
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
