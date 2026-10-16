"use client";

import { type ReactNode, useState } from "react";
import {
  type DemoSummary,
  type ExperimentMarket,
  LIVE_MIRROR_MODES,
  type LiveAutoOff,
  type LiveAutoSnapshot,
  type LiveMirrorMode,
  type LiveThresholds,
  useSetExperimentLiveMode,
} from "@/entities/experiment";
import {
  deriveLiveStatus,
  LIVE_MODE_LABEL,
  useLiveAccount,
} from "@/entities/live-account";
import { cn, formatDateTime } from "@/shared/lib";
import {
  dailyLimitNote,
  keyBlockReason,
  keyBlockShort,
  LIVE_MODE_MEANING,
  liveModeHint,
  liveModeNote,
} from "../lib/describe";
import { LiveModeDialog, type LiveOnMode } from "./LiveModeDialog";

const COINM_REASON = "COIN-M на реальном счёте не торгуется";

/**
 * Переключатель «Реальный счёт» эксперимента «Выкл · Авто · Вкл · Вкл + автовыкл» (spec 0049, 0053, AC1). Всё, кроме
 * «Выкл», — модалка с описанием режима, порогами (для «Авто» и «Вкл + автовыкл») и словом «РЕАЛ»; «Выкл» — сразу
 * (открытые позиции доживают). Активные «Авто» и «Вкл + автовыкл» — модалка порогов. Под переключателем — решение
 * «Авто», пороги или пометка автовыключения; при наведении — смысл положения и последнее решение автомата.
 * COIN-M — недоступно; ключ не «✅ годится» — недоступно включение с причиной.
 */
export function LiveMirrorToggle({
  experiment,
}: {
  experiment: {
    id: string;
    name: string;
    market: ExperimentMarket;
    liveMirror: boolean;
    liveMirrorMode: LiveMirrorMode;
    liveThresholds: LiveThresholds;
    liveAuto: LiveAutoSnapshot | null;
    liveAutoOff: LiveAutoOff | null;
    demo: DemoSummary;
  };
}) {
  const [dialog, setDialog] = useState<LiveOnMode | null>(null);
  const mutation = useSetExperimentLiveMode();
  const live = useLiveAccount();
  const { id, liveMirror, liveMirrorMode: mode } = experiment;
  const coinm = experiment.market === "coinm";
  const status = live.data
    ? deriveLiveStatus(live.data.state, Date.now(), live.data.silentAfterMs)
    : null;
  const keyReason = keyBlockReason(status, formatDateTime);
  const keyShort = keyBlockShort(status);
  const limit = dailyLimitNote(
    live.data?.trading.experiments.find((e) => e.id === id),
    formatDateTime,
  );
  const view = { ...experiment, mode };
  const note = liveModeNote(view, formatDateTime);

  const choose = (next: LiveMirrorMode) => {
    mutation.reset();
    if (next === "off") {
      if (mode !== "off") mutation.mutate({ id, mode: "off" });
      return;
    }
    // Активные «Авто» и «Вкл + автовыкл» — поменять пороги; активное «Вкл» — ничего.
    if (next === mode && next === "on") return;
    setDialog(next);
  };

  const segmentTitle = (m: LiveMirrorMode) => {
    if (coinm) return COINM_REASON;
    if (m === mode) return liveModeHint(view, formatDateTime);
    if (m !== "off" && keyReason) return keyReason;
    return LIVE_MODE_MEANING[m];
  };

  return (
    <div
      className="inline-flex flex-col items-center gap-0.5"
      title={
        coinm
          ? COINM_REASON
          : [
              liveModeHint(view, formatDateTime),
              mode === "off" ? keyReason : null,
            ]
              .filter(Boolean)
              .join("\n")
      }
    >
      <fieldset
        aria-label={`Реальный счёт ${id}`}
        className="inline-flex rounded-md border p-0.5 text-xs"
      >
        {LIVE_MIRROR_MODES.map((m) => {
          const active = m === mode;
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              title={segmentTitle(m)}
              disabled={
                coinm ||
                mutation.isPending ||
                (m !== "off" && !active && keyReason !== null)
              }
              onClick={() => choose(m)}
              className={cn(
                "rounded px-1.5 py-0.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                !active && "text-muted-foreground hover:bg-accent",
                active && m === "off" && "bg-muted font-medium text-foreground",
                active &&
                  m !== "off" &&
                  (liveMirror
                    ? "bg-amber-600 font-medium text-white dark:bg-amber-500"
                    : "bg-amber-500/20 font-medium text-amber-800 dark:text-amber-300"),
              )}
            >
              {active && m === "auto"
                ? liveMirror
                  ? "Авто · вкл"
                  : "Авто"
                : LIVE_MODE_LABEL[m]}
            </button>
          );
        })}
      </fieldset>
      {coinm && <Note>{COINM_REASON}</Note>}
      {!coinm && note && !(mode === "auto" && liveMirror) && (
        <Note tone={mode === "off" ? "danger" : "muted"}>{note}</Note>
      )}
      {!coinm && mode === "off" && status && keyShort && live.data && (
        <Note>{keyShort}</Note>
      )}
      {limit && <Note tone="danger">дневной лимит: {limit}</Note>}
      {mutation.error && dialog === null && (
        <Note tone="danger">{mutation.error.message}</Note>
      )}
      {dialog && (
        <LiveModeDialog
          experiment={experiment}
          mode={dialog}
          edit={dialog === mode}
          keyReason={dialog === mode ? null : keyReason}
          mutation={mutation}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

/**
 * Подпись под переключателем: переносится в пределах ячейки (ячейка таблицы — nowrap), иначе длинная причина вылезала
 * на соседнюю колонку (найдено в 0052). Подробности — в подсказке переключателя.
 */
function Note({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "danger";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "max-w-40 text-center text-[10px] leading-tight break-words whitespace-normal",
        tone === "danger" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}
