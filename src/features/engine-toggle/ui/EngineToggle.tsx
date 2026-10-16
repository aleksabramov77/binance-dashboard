"use client";

import { useId, useState } from "react";
import {
  describeExposure,
  type EngineStatus,
  useEngineExposure,
  useEngineStatus,
} from "@/entities/experiment";
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
import { Switch } from "@/shared/ui/Switch";
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

/**
 * Что останется без проверки после выключения. Монтируется вместе с модалкой — числа каждый раз
 * свежие; ошибка подсчёта не мешает выключить.
 */
function DisableDescription() {
  const exposure = useEngineExposure();
  if (exposure.isPending)
    return <DialogDescription>Считаю открытые сделки…</DialogDescription>;
  if (exposure.isError)
    return (
      <DialogDescription>
        Открытые paper-сделки и демо-позиции перестанут проверяться до
        включения.
      </DialogDescription>
    );
  return (
    <DialogDescription>
      {describeExposure(exposure.data)} — их стопы и тейки перестанут
      проверяться до включения.
    </DialogDescription>
  );
}

/**
 * Тумблер «Автоторговля» — вкл/выкл движка лаборатории (paper-сделки, без реальных ордеров).
 * Переключение — только через подтверждение в модалке (spec 0044); стоит в шапке и в /settings,
 * состояние общее (один query-ключ статуса).
 */
export function EngineToggle({ className }: { className?: string }) {
  const id = useId();
  const status = useEngineStatus();
  const toggle = useToggleEngine();
  const [open, setOpen] = useState(false);
  // Что подтверждаем — фиксируем при открытии: фоновый опрос статуса не подменит модалку на ходу.
  const [target, setTarget] = useState(false);
  const error = status.error ?? toggle.error;

  const confirm = () =>
    toggle.mutate(target, { onSuccess: () => setOpen(false) });

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
        // Значение меняет только подтверждение в модалке.
        onCheckedChange={(next) => {
          toggle.reset();
          setTarget(next);
          setOpen(true);
        }}
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
      <Dialog open={open} onOpenChange={(o) => !toggle.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {target ? "Включить автоторговлю?" : "Выключить автоторговлю?"}
            </DialogTitle>
            {target ? (
              <DialogDescription>
                Движок начнёт тикать раз в минуту: проверять стопы и тейки
                открытых сделок и открывать новые. Выходы, пропущенные, пока он
                был выключен, догонятся по 1m-свечам.
              </DialogDescription>
            ) : (
              <DisableDescription />
            )}
          </DialogHeader>
          {toggle.error && (
            <p className="text-sm text-destructive">{toggle.error.message}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={toggle.isPending}
              onClick={() => setOpen(false)}
            >
              Отмена
            </Button>
            <Button
              variant={target ? "default" : "destructive"}
              disabled={toggle.isPending}
              onClick={confirm}
            >
              {toggle.isPending
                ? "Выполняю…"
                : target
                  ? "Включить"
                  : "Выключить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
