"use client";

import { useState } from "react";
import {
  ASSET_GROUPS,
  type ExperimentMarket,
  useSetExperimentDemoMirror,
} from "@/entities/experiment";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

/**
 * Чекбокс «торговать на демо-счёте» с подтверждением в модалке (spec 008): включение и выключение
 * demo-зеркала эксперимента. Значение хранится в БД (experiments.demo_mirror). У групп без зеркала
 * (COIN-M, spec 0023) галочка выключена, причина — в подсказке.
 */
export function DemoMirrorToggle({
  experiment,
  demoConfigured,
}: {
  experiment: {
    id: string;
    name: string;
    market: ExperimentMarket;
    demoMirror: boolean;
  };
  /** На сервере задан ключ Binance Demo; нет — включить нельзя (выключить можно). */
  demoConfigured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useSetExperimentDemoMirror();
  const next = !experiment.demoMirror;
  const blocked = next && !demoConfigured;
  // Выключить уже включённое можно всегда; включить — только там, где зеркало умеет группу.
  const unavailable = next
    ? ASSET_GROUPS[experiment.market].demoMirrorBlocked
    : null;

  const confirm = () =>
    mutation.mutate(
      { id: experiment.id, demoMirror: next },
      { onSuccess: () => setOpen(false) },
    );

  return (
    <>
      <Checkbox
        checked={experiment.demoMirror}
        disabled={mutation.isPending || unavailable !== null}
        aria-label={`Торговля на демо-счёте: ${experiment.id}`}
        title={
          unavailable ??
          (experiment.demoMirror
            ? "Торгует на демо-счёте Binance — снять"
            : "Включить торговлю на демо-счёте Binance")
        }
        // Значение меняет только подтверждение в модалке.
        onCheckedChange={() => {
          mutation.reset();
          setOpen(true);
        }}
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {next
                ? `Включить торговлю на демо-счёте для ${experiment.id}?`
                : `Выключить торговлю на демо-счёте для ${experiment.id}?`}
            </DialogTitle>
            <DialogDescription>{experiment.name}</DialogDescription>
          </DialogHeader>
          {next ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                Каждый новый вход эксперимента повторится на демо-счёте Binance
                (demo.binance.com, виртуальные деньги) в течение 1–2 минут: тот
                же объём (~$50), стоп и тейк выставятся на бирже.
              </li>
              <li>
                Когда paper-сделка закроется, позиция на демо-счёте закроется по
                рынку.
              </li>
              <li>
                Уже открытые paper-сделки старше 10 минут не повторяются —
                только новые входы.
              </li>
              <li>Реальный счёт и реальные деньги не затрагиваются.</li>
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Новые входы эксперимента больше не будут повторяться на
              демо-счёте. Уже открытые демо-позиции останутся и закроются вместе
              со своими paper-сделками.
            </p>
          )}
          {blocked && (
            <p className="text-sm text-destructive">
              На сервере не задан ключ Binance Demo (BINANCE_DEMO_API_KEY /
              SECRET) — включить торговлю на демо-счёте нельзя.
            </p>
          )}
          {mutation.error && (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              variant={next ? "default" : "destructive"}
              disabled={blocked || mutation.isPending}
              onClick={confirm}
            >
              {mutation.isPending
                ? "Сохраняю…"
                : next
                  ? "Включить торговлю"
                  : "Выключить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
