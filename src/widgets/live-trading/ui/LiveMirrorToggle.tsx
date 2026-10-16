"use client";

import Link from "next/link";
import { useId, useState } from "react";
import {
  type DemoSummary,
  type ExperimentMarket,
  formatProfitFactor,
  formatRate,
  formatSignedUsd,
  type MirrorAutoSnapshot,
  useSetExperimentLiveMirror,
} from "@/entities/experiment";
import {
  deriveLiveStatus,
  LIVE,
  useLiveAccount,
} from "@/entities/live-account";
import { cn, formatDateTime } from "@/shared/lib";
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
import { dailyLimitNote, keyBlockReason, LIMIT_LINES } from "../lib/describe";
import { LIVE_STOP_HREF } from "./LiveTradingStrip";

const COINM_REASON = "COIN-M на реальном счёте не торгуется";

/**
 * Переключатель «Реальный счёт» эксперимента «Выкл / Вкл» (spec 0049, AC1). «Вкл» — модалка с лимитами,
 * демо-статистикой и словом «РЕАЛ»; «Выкл» — сразу (открытые позиции доживают). COIN-M — недоступно; ключ не
 * «✅ годится» — недоступно «Вкл» с причиной. Рядом — пометка сработавшего дневного лимита.
 */
export function LiveMirrorToggle({
  experiment,
}: {
  experiment: {
    id: string;
    name: string;
    market: ExperimentMarket;
    liveMirror: boolean;
    demo: DemoSummary;
    demoMirrorAuto: MirrorAutoSnapshot | null;
  };
}) {
  const [confirmOn, setConfirmOn] = useState(false);
  const [word, setWord] = useState("");
  const wordId = useId();
  const mutation = useSetExperimentLiveMirror();
  const live = useLiveAccount();
  const { id, liveMirror } = experiment;
  const coinm = experiment.market === "coinm";
  const status = live.data
    ? deriveLiveStatus(live.data.state, Date.now(), live.data.silentAfterMs)
    : null;
  const keyReason = keyBlockReason(status, formatDateTime);
  const limit = dailyLimitNote(
    live.data?.trading.experiments.find((e) => e.id === id),
    formatDateTime,
  );
  const wordOk = word.trim().toUpperCase() === LIVE.confirmWord;

  const turnOn = () => {
    mutation.reset();
    setWord("");
    setConfirmOn(true);
  };
  const turnOff = () => {
    mutation.reset();
    mutation.mutate({ id, liveMirror: false });
  };
  const confirm = () =>
    mutation.mutate(
      { id, liveMirror: true, confirm: word },
      { onSuccess: () => setConfirmOn(false) },
    );

  const d = experiment.demo;
  const avgR = experiment.demoMirrorAuto?.check.avgR ?? null;

  return (
    <div
      className="inline-flex flex-col items-center gap-0.5"
      title={coinm ? COINM_REASON : undefined}
    >
      <fieldset
        aria-label={`Реальный счёт ${id}`}
        className="inline-flex rounded-md border p-0.5 text-xs"
      >
        <button
          type="button"
          aria-pressed={!liveMirror}
          disabled={coinm || mutation.isPending}
          title={
            coinm
              ? COINM_REASON
              : "Выключить: новых реальных входов нет, открытые позиции доживают"
          }
          onClick={() => liveMirror && turnOff()}
          className={cn(
            "rounded px-1.5 py-0.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            liveMirror
              ? "text-muted-foreground hover:bg-accent"
              : "bg-muted font-medium text-foreground",
          )}
        >
          Выкл
        </button>
        <button
          type="button"
          aria-pressed={liveMirror}
          disabled={
            coinm || mutation.isPending || (!liveMirror && keyReason !== null)
          }
          title={
            coinm
              ? COINM_REASON
              : (keyReason ??
                "Включить: свежие входы эксперимента повторяются на реальном субсчёте")
          }
          onClick={() => !liveMirror && turnOn()}
          className={cn(
            "rounded px-1.5 py-0.5 whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            liveMirror
              ? "bg-amber-600 font-medium text-white dark:bg-amber-500"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          Вкл
        </button>
      </fieldset>
      {coinm && (
        <span className="max-w-32 whitespace-normal text-center text-[10px] leading-tight text-muted-foreground">
          {COINM_REASON}
        </span>
      )}
      {!coinm && !liveMirror && keyReason && live.data && (
        <span className="max-w-40 whitespace-normal text-center text-[10px] leading-tight text-muted-foreground">
          {keyReason}
        </span>
      )}
      {limit && (
        <span className="max-w-40 whitespace-normal text-center text-[10px] leading-tight text-destructive">
          дневной лимит: {limit}
        </span>
      )}
      {mutation.error && !confirmOn && (
        <span className="max-w-40 whitespace-normal text-[10px] leading-tight text-destructive">
          {mutation.error.message}
        </span>
      )}
      <Dialog open={confirmOn} onOpenChange={setConfirmOn}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Торговать реальными деньгами: {id}?</DialogTitle>
            <DialogDescription>{experiment.name}</DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Каждый новый вход эксперимента воркер повторит на торговом субсчёте
            Binance в течение 1–2 минут: те же стоп и тейк, плечо 1.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {LIMIT_LINES.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="text-sm">
            <span className="font-medium">Демо-зеркало эксперимента: </span>
            {d.closed
              ? `${d.closed} закрытых сделок, win rate ${formatRate(d.wins / d.closed)}, PnL ${formatSignedUsd(d.pnl)}, profit factor ${formatProfitFactor(d.profitFactor, d.grossProfit)}`
              : "закрытых сделок на демо ещё нет"}
            {avgR !== null &&
              ` · средний R paper (проверка авто-зеркала): ${avgR.toFixed(2)}`}
          </p>
          <Link
            href={LIVE_STOP_HREF}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            Аварийный стоп в настройках →
          </Link>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor={wordId}>
              Чтобы включить, введите слово «{LIVE.confirmWord}»
            </label>
            <Input
              id={wordId}
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoComplete="off"
            />
          </div>
          {keyReason && <p className="text-sm text-destructive">{keyReason}</p>}
          {mutation.error && (
            <p className="text-sm text-destructive">{mutation.error.message}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOn(false)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              disabled={!wordOk || keyReason !== null || mutation.isPending}
              onClick={confirm}
            >
              {mutation.isPending ? "Включаю…" : "Включить реальный счёт"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
