"use client";

import { useLiveAccount, useLiveHalt } from "@/entities/live-account";
import { ConfirmAction } from "@/shared/ui/ConfirmAction";

/**
 * Аварийный стоп реального счёта (spec 0049, AC6): «Стоп входов» (или «Возобновить», пока стоп включён) и «Закрыть
 * всё» — обе с подтверждением. Те же кнопки — в карточке /settings и в полосе над таблицей /experiments.
 */
export function LiveHaltControls() {
  const live = useLiveAccount();
  const halt = useLiveHalt();
  const stopped = live.data?.trading.halt.stopped ?? false;
  const closeAllPending = live.data?.trading.halt.closeAllRequestedAt !== null;
  const positions = live.data?.trading.positions.length ?? 0;
  const error = halt.error?.message ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {stopped && closeAllPending && live.data && (
        <span className="text-xs text-muted-foreground">
          Возобновить можно после «Закрыть всё»
        </span>
      )}
      {stopped ? (
        <ConfirmAction
          label="Возобновить"
          variant="outline"
          title="Возобновить реальные входы?"
          description="Включённые эксперименты снова будут повторять свежие входы на торговом субсчёте Binance."
          confirmLabel="Возобновить"
          disabled={!live.data || halt.isPending || closeAllPending}
          pending={halt.isPending}
          error={error}
          onOpen={() => halt.reset()}
          onConfirm={(close) =>
            halt.mutate({ action: "resume" }, { onSuccess: close })
          }
        />
      ) : (
        <ConfirmAction
          label="Стоп входов"
          variant="outline"
          title="Остановить новые реальные входы?"
          description="Новые сделки на реальном счёте не открываются, пока вы не нажмёте «Возобновить». Открытые позиции доживают со своими TP/SL."
          confirmLabel="Остановить входы"
          disabled={!live.data || halt.isPending}
          pending={halt.isPending}
          error={error}
          onOpen={() => halt.reset()}
          onConfirm={(close) =>
            halt.mutate({ action: "stop" }, { onSuccess: close })
          }
        />
      )}
      <ConfirmAction
        label={
          closeAllPending && live.data
            ? `Закрытие идёт: осталось ${positions}`
            : "Закрыть всё"
        }
        title="Закрыть все реальные позиции по рынку?"
        description={`Входы остановятся, а воркер на ближайшем прогоне (до 2 минут) закроет по рынку все реальные позиции (сейчас ${positions}) и снимет их ордера. Возобновить входы — отдельной кнопкой.`}
        confirmLabel="Закрыть всё"
        disabled={!live.data || halt.isPending}
        pending={halt.isPending}
        error={error}
        onOpen={() => halt.reset()}
        onConfirm={(close) =>
          halt.mutate({ action: "close_all" }, { onSuccess: close })
        }
      />
    </div>
  );
}
