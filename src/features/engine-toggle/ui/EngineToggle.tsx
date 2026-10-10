"use client";

import { useId } from "react";
import { type EngineStatus, useEngineStatus } from "@/entities/experiment";
import { cn, formatDateTime } from "@/shared/lib";
import { Switch } from "@/shared/ui/switch";
import { useToggleEngine } from "../api/useToggleEngine";

function describe(status: EngineStatus | undefined): string {
  if (!status) return "Статус движка загружается";
  const lines = [
    status.enabled
      ? "Движок экспериментов включён: paper-сделки по 40 стратегиям каждую минуту"
      : "Движок экспериментов выключен",
    `Исполнитель тиков: ${status.runner}`,
  ];
  if (status.lastTick)
    lines.push(
      `Последний тик ${formatDateTime(status.lastTick.at)}: открыто ${status.lastTick.opened}, закрыто ${status.lastTick.closed}`,
    );
  return lines.join("\n");
}

/** Тумблер «Автоторговля» — вкл/выкл движка лаборатории (paper-сделки, без реальных ордеров). */
export function EngineToggle({ className }: { className?: string }) {
  const id = useId();
  const status = useEngineStatus();
  const toggle = useToggleEngine();
  const error = status.error ?? toggle.error;

  return (
    <div
      className={cn("flex shrink-0 items-center gap-2 text-xs", className)}
      title={error ? error.message : describe(status.data)}
    >
      <Switch
        id={id}
        size="sm"
        checked={status.data?.enabled ?? false}
        disabled={!status.data || toggle.isPending}
        onCheckedChange={(next) => toggle.mutate(next)}
      />
      <label
        htmlFor={id}
        className={cn(
          "font-medium whitespace-nowrap",
          error ? "text-destructive" : "text-foreground",
        )}
      >
        Автоторговля
      </label>
    </div>
  );
}
