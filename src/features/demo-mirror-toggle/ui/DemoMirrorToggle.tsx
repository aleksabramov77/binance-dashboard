"use client";

import { useState } from "react";
import {
  ASSET_GROUPS,
  DEMO_MIRROR_MODES,
  type DemoMirrorMode,
  type ExperimentMarket,
  type MirrorAutoSnapshot,
  useSetExperimentMirrorMode,
} from "@/entities/experiment";
import { cn } from "@/shared/lib";
import { Button } from "@/shared/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/Dialog";
import { MODE_MEANING, mirrorModeHint } from "../lib/modeHint";

/** Подпись под переключателем без ключа Binance Demo (полный текст — в подсказке «Вкл»). */
const NO_KEY_CAPTION = "«Вкл» недоступно: нет ключа Binance Demo";

const LABEL: Record<DemoMirrorMode, string> = {
  off: "Выкл",
  auto: "Авто",
  on: "Вкл",
};

/**
 * Переключатель демо-зеркала «Выкл · Авто · Вкл» (spec 008, 0043). «Вкл» — с подтверждением в модалке, «Выкл» и
 * «Авто» — сразу («Авто» сразу решает автомат). В «Авто» подсвечено решение автомата: «Авто · вкл» (цвет демо-колонок)
 * или «Авто · выкл» (приглушённо); у ручных положений — пометка «вручную». У группы без зеркала переключатель
 * недоступен, без ключа Binance Demo недоступно «Вкл»; причина — подписью под переключателем, как у «Реального счёта»
 * (spec 0056, AC2), а не только в подсказке.
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
    demoMirrorMode: DemoMirrorMode;
    demoMirrorAuto: MirrorAutoSnapshot | null;
  };
  /** На сервере задан ключ Binance Demo; нет — «Вкл» недоступно. */
  demoConfigured: boolean;
}) {
  const [confirmOn, setConfirmOn] = useState(false);
  const mutation = useSetExperimentMirrorMode();
  const { id, demoMirrorMode: mode, demoMirror } = experiment;
  const blocked = ASSET_GROUPS[experiment.market].demoMirrorBlocked;
  // Видимая причина недоступности: группа без зеркала — весь переключатель, нет ключа — «Вкл».
  const caption = blocked ?? (demoConfigured ? null : NO_KEY_CAPTION);

  const choose = (next: DemoMirrorMode) => {
    if (next === mode) return;
    mutation.reset();
    if (next === "on") setConfirmOn(true);
    else mutation.mutate({ id, mode: next });
  };
  const confirm = () =>
    mutation.mutate(
      { id, mode: "on" },
      { onSuccess: () => setConfirmOn(false) },
    );

  // У «Авто» — ещё и последнее изменение и проверка автомата: браузер показывает title кнопки под курсором.
  const segmentTitle = (m: DemoMirrorMode) => {
    if (m === "on" && !demoConfigured)
      return "На сервере не задан ключ Binance Demo — включить торговлю на демо-счёте нельзя.";
    return m === "auto"
      ? mirrorModeHint("auto", experiment.demoMirrorAuto)
      : MODE_MEANING[m];
  };

  return (
    <div
      className="inline-flex flex-col items-center gap-0.5"
      title={blocked ?? mirrorModeHint(mode, experiment.demoMirrorAuto)}
    >
      <fieldset
        aria-label={`Демо-зеркало ${id}`}
        className="inline-flex rounded-md border p-0.5 text-xs"
      >
        {DEMO_MIRROR_MODES.map((m) => {
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              title={blocked ?? segmentTitle(m)}
              disabled={
                blocked !== null ||
                mutation.isPending ||
                (m === "on" && !demoConfigured && !active)
              }
              onClick={() => choose(m)}
              className={cn(
                "rounded px-1.5 py-0.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                !active && "text-muted-foreground hover:bg-accent",
                active && m === "off" && "bg-muted font-medium text-foreground",
                active &&
                  m === "on" &&
                  "bg-sky-600 font-medium text-white dark:bg-sky-500",
                active &&
                  m === "auto" &&
                  (demoMirror
                    ? "bg-sky-500/20 font-medium text-sky-700 dark:text-sky-300"
                    : "bg-muted font-medium text-muted-foreground"),
              )}
            >
              {active && m === "auto"
                ? `Авто · ${demoMirror ? "вкл" : "выкл"}`
                : LABEL[m]}
            </button>
          );
        })}
      </fieldset>
      {mode !== "auto" && (
        <span className="text-[10px] leading-none text-muted-foreground">
          вручную
        </span>
      )}
      {caption && (
        <span className="max-w-32 text-center text-[10px] leading-tight text-muted-foreground">
          {caption}
        </span>
      )}
      {mutation.error && !confirmOn && (
        <span className="max-w-40 text-[10px] leading-tight text-destructive">
          {mutation.error.message}
        </span>
      )}
      <Dialog open={confirmOn} onOpenChange={setConfirmOn}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Включить торговлю на демо-счёте для {id} вручную?
            </DialogTitle>
            <DialogDescription>{experiment.name}</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>
              Каждый новый вход эксперимента повторится на демо-счёте Binance
              (demo.binance.com, виртуальные деньги) в течение 1–2 минут: тот же
              объём (~$50), стоп и тейк выставятся на бирже.
            </li>
            {experiment.market === "coinm" && (
              <li>
                COIN-M: то же число контрактов, что у paper-сделки (BTC — $100,
                остальные — $10), маржа — в монете контракта; вход пропускается,
                если её свободной маржи после входа останется меньше $50.
              </li>
            )}
            <li>
              Когда paper-сделка закроется, позиция на демо-счёте закроется по
              рынку.
            </li>
            <li>
              Уже открытые paper-сделки старше 10 минут не повторяются — только
              новые входы.
            </li>
            <li>
              Ручное «Вкл» автомат не выключит: если эксперимент похоже
              убыточен, придёт подсказка в Telegram.
            </li>
            <li>Реальный счёт и реальные деньги не затрагиваются.</li>
          </ul>
          {!demoConfigured && (
            <p className="text-sm text-destructive">
              На сервере не задан ключ Binance Demo (BINANCE_DEMO_API_KEY /
              SECRET) — включить торговлю на демо-счёте нельзя.
            </p>
          )}
          {mutation.error && (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOn(false)}>
              Отмена
            </Button>
            <Button
              disabled={!demoConfigured || mutation.isPending}
              onClick={confirm}
            >
              {mutation.isPending ? "Сохраняю…" : "Включить торговлю"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
