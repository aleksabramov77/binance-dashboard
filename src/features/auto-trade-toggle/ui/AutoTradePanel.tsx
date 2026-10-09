"use client";

import { useId } from "react";
import type { AutoTradeOutcome } from "@/entities/trade";
import { cn, formatDateTime, formatPair } from "@/shared/lib";
import { Card, CardContent } from "@/shared/ui/card";
import { Switch } from "@/shared/ui/switch";
import { useAutoTrade, useToggleAutoTrade } from "../api/useAutoTrade";

const OUTCOME_VIEW: Record<AutoTradeOutcome, { label: string; tone: string }> =
  {
    opened: { label: "вход", tone: "text-positive" },
    unprotected: { label: "без защиты", tone: "text-primary" },
    rejected: { label: "отказ", tone: "text-destructive" },
    error: { label: "ошибка", tone: "text-destructive" },
    skipped: { label: "пропуск", tone: "text-muted-foreground" },
  };

/** Сколько последних решений показывать. */
const ACTIONS_SHOWN = 8;

export function AutoTradePanel() {
  const id = useId();
  const state = useAutoTrade();
  const toggle = useToggleAutoTrade();
  const data = state.data;
  const enabled = toggle.isPending
    ? toggle.variables
    : (data?.enabled ?? false);
  const minutes = data ? Math.round(data.intervalMs / 60_000) : null;

  return (
    <Card>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Switch
            id={id}
            checked={enabled}
            disabled={!data || toggle.isPending}
            onCheckedChange={(next) => toggle.mutate(next)}
          />
          <label htmlFor={id} className="font-medium">
            Автосделки (демо)
          </label>
          <span className="text-muted-foreground">
            {data?.enabled
              ? `Включены${data.enabledAt ? ` с ${formatDateTime(data.enabledAt)}` : ""}: каждые ${minutes} мин берём все новые сетапы.`
              : "Выключены: сделки только вручную."}
            {data?.lastCycleAt &&
              ` Последний цикл ${formatDateTime(data.lastCycleAt)}.`}
          </span>
        </div>
        {(state.error || toggle.error || data?.lastError) && (
          <p className="text-destructive">
            {state.error?.message ?? toggle.error?.message ?? data?.lastError}
          </p>
        )}
        {data && data.actions.length > 0 && (
          <ul className="space-y-0.5 text-xs">
            {data.actions.slice(0, ACTIONS_SHOWN).map((a) => (
              <li
                key={`${a.at}-${a.symbol}-${a.outcome}`}
                className="flex gap-2"
              >
                <span className="shrink-0 text-muted-foreground">
                  {formatDateTime(a.at)}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-medium",
                    OUTCOME_VIEW[a.outcome].tone,
                  )}
                >
                  {OUTCOME_VIEW[a.outcome].label}
                </span>
                <span className="shrink-0">
                  {formatPair(a.symbol)}{" "}
                  {a.direction === "long" ? "LONG" : "SHORT"}
                </span>
                <span
                  className="truncate text-muted-foreground"
                  title={a.reason}
                >
                  {a.reason}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Сервер сам сканирует рынок и входит по каждому сетапу (ready и watch),
          который прошёл предпроверку по свежим свечам: риск 1% кошелька, объём
          до $100, плечо 2x, TP1 и SL сразу. Пропуск — уже в сделке, пауза 2 ч
          после автовхода в ту же пару или 30 мин после отказа. Работает и с
          закрытой вкладкой, пока запущен сервер.
        </p>
      </CardContent>
    </Card>
  );
}
