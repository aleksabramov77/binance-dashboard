"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  type DemoSummary,
  formatProfitFactor,
  formatRate,
  formatSignedUsd,
  type LiveThresholds,
  liveThresholdsSchema,
  type useSetExperimentLiveMode,
} from "@/entities/experiment";
import { LIVE, LIVE_MODE_LABEL } from "@/entities/live-account";
import { Button } from "@/shared/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/Dialog";
import { Input } from "@/shared/ui/Input";
import { LIMIT_LINES, LIVE_MODE_MEANING } from "../lib/describe";
import { LIVE_STOP_HREF } from "./LiveTradingStrip";

/** Положения, которые включают реальный счёт (или могут включить — «Авто»): модалка со словом «РЕАЛ». */
export type LiveOnMode = "auto" | "on" | "on_autooff";

const formSchema = liveThresholdsSchema.extend({
  word: z
    .string()
    .refine(
      (w) => w.trim().toUpperCase() === LIVE.confirmWord,
      `Введите слово «${LIVE.confirmWord}»`,
    ),
});
type FormValues = z.infer<typeof formSchema>;

const TITLE: Record<LiveOnMode, string> = {
  auto: "Реальный счёт — «Авто»",
  on: "Торговать реальными деньгами",
  on_autooff: "Реальный счёт — «Вкл + автовыкл»",
};

/**
 * Модалка включения реального счёта (spec 0049, 0053, AC1): описание режима, лимиты 0049, демо-статистика, для «Авто»
 * и «Вкл + автовыкл» — пороги ($ 1–1000, серия 1–50; Zod), слово «РЕАЛ». edit — тот же режим: меняются только пороги.
 */
export function LiveModeDialog({
  experiment,
  mode,
  edit,
  keyReason,
  mutation,
  onClose,
}: {
  experiment: {
    id: string;
    name: string;
    demo: DemoSummary;
    liveThresholds: LiveThresholds;
  };
  mode: LiveOnMode;
  edit: boolean;
  keyReason: string | null;
  mutation: ReturnType<typeof useSetExperimentLiveMode>;
  onClose: () => void;
}) {
  const ids = { word: useId(), loss: useId(), streak: useId() };
  const withThresholds = mode !== "on";
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: { ...experiment.liveThresholds, word: "" },
  });
  const errors = form.formState.errors;
  const submit = form.handleSubmit((v) =>
    mutation.mutate(
      {
        id: experiment.id,
        mode,
        confirm: v.word,
        ...(withThresholds && {
          thresholds: { lossUsd: v.lossUsd, streak: v.streak },
        }),
      },
      { onSuccess: onClose },
    ),
  );
  const d = experiment.demo;

  return (
    <Dialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <DialogContent>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              {edit ? "Пороги автовыключения" : TITLE[mode]}: {experiment.id}
              {edit ? "" : "?"}
            </DialogTitle>
            <DialogDescription>{experiment.name}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">{LIVE_MODE_MEANING[mode]}</p>
          {!edit && (
            <>
              <p className="text-sm">
                Каждый новый вход эксперимента воркер повторит на торговом
                субсчёте Binance в течение 1–2 минут: те же стоп и тейк, плечо
                1.
                {mode === "auto" &&
                  " «Авто» включает реальную торговлю без подтверждения в момент включения — согласие даётся сейчас."}
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {LIMIT_LINES.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                <li>«Стоп входов» главнее любого режима.</li>
              </ul>
              <p className="text-sm">
                <span className="font-medium">Демо-зеркало эксперимента: </span>
                {d.closed
                  ? `${d.closed} закрытых сделок, win rate ${formatRate(d.wins / d.closed)}, PnL ${formatSignedUsd(d.pnl)}, profit factor ${formatProfitFactor(d.profitFactor, d.grossProfit)}`
                  : "закрытых сделок на демо ещё нет"}
              </p>
              <Link
                href={LIVE_STOP_HREF}
                className="text-sm font-medium underline-offset-4 hover:underline"
              >
                Аварийный стоп в настройках →
              </Link>
            </>
          )}
          {withThresholds && (
            <fieldset className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
              <legend className="px-1 font-medium">
                Выключить, если с момента включения
              </legend>
              <div className="flex flex-wrap gap-3">
                <label htmlFor={ids.loss} className="flex flex-col gap-1">
                  убыток, $
                  <Input
                    id={ids.loss}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    className="w-28"
                    aria-invalid={errors.lossUsd ? true : undefined}
                    {...form.register("lossUsd", { valueAsNumber: true })}
                  />
                </label>
                <label htmlFor={ids.streak} className="flex flex-col gap-1">
                  убыточных сделок подряд
                  <Input
                    id={ids.streak}
                    type="number"
                    inputMode="numeric"
                    step="1"
                    className="w-28"
                    aria-invalid={errors.streak ? true : undefined}
                    {...form.register("streak", { valueAsNumber: true })}
                  />
                </label>
              </div>
              {(errors.lossUsd || errors.streak) && (
                <p className="text-destructive">
                  {[errors.lossUsd?.message, errors.streak?.message]
                    .filter(Boolean)
                    .join("; ")}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                После автовыключения переключатель уходит в «Выкл» с причиной и
                датой; снова включить — только вручную.
              </p>
            </fieldset>
          )}
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={ids.word}>
              Чтобы {edit ? "сохранить" : "включить"}, введите слово «
              {LIVE.confirmWord}»
            </label>
            <Input
              id={ids.word}
              autoComplete="off"
              {...form.register("word")}
            />
          </div>
          {keyReason && <p className="text-sm text-destructive">{keyReason}</p>}
          {mutation.error && (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={
                !form.formState.isValid ||
                keyReason !== null ||
                mutation.isPending
              }
            >
              {mutation.isPending
                ? "Сохраняю…"
                : edit
                  ? "Сохранить пороги"
                  : `Включить: ${LIVE_MODE_LABEL[mode]}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
