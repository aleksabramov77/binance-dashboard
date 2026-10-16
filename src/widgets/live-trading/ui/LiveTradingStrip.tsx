"use client";

import Link from "next/link";
import {
  deriveLiveStatus,
  LIVE,
  useLiveAccount,
} from "@/entities/live-account";
import { cn, formatDateTime } from "@/shared/lib";
import { haltText, keyBlockReason } from "../lib/describe";
import { LiveHaltControls } from "./LiveHaltControls";

/** Якорь аварийного блока в карточке «Реальный счёт» на /settings. */
export const LIVE_STOP_HREF = "/settings#live-stop";

/**
 * Полоса «Реальный счёт» над таблицей /experiments (spec 0049, AC6): статус торговли, открытые позиции из 5, обе
 * кнопки аварийного стопа и ссылка на аварийный блок /settings.
 */
export function LiveTradingStrip() {
  const live = useLiveAccount();
  const data = live.data;
  const status = data
    ? deriveLiveStatus(data.state, Date.now(), data.silentAfterMs)
    : null;
  const keyIssue = data ? keyBlockReason(status, formatDateTime) : null;
  const halt = data?.trading.halt;
  return (
    <section
      aria-label="Реальный счёт"
      className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">
          Реальный счёт:{" "}
          {live.error ? (
            <span className="text-destructive">{live.error.message}</span>
          ) : !data || !halt ? (
            "загрузка…"
          ) : (
            <span className={cn(halt.stopped && "text-destructive")}>
              торговля {haltText(halt, formatDateTime)}
            </span>
          )}
        </span>
        {data && (
          <span className="text-xs text-muted-foreground">
            Открыто позиций: {data.trading.positions.length} из{" "}
            {LIVE.maxOpenPositions}
            {keyIssue && ` · ${keyIssue}`}
            {halt?.closeAllRequestedAt && " · «Закрыть всё» ждёт воркер"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <LiveHaltControls />
        <Link
          href={LIVE_STOP_HREF}
          className="text-xs font-medium underline-offset-4 hover:underline"
        >
          Аварийный стоп в настройках →
        </Link>
      </div>
    </section>
  );
}
