"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  experimentsQueryKey,
  useSetExperimentEnabled,
} from "@/entities/experiment";
import { Switch } from "@/shared/ui/Switch";
import { DisableExperimentDialog } from "./DisableExperimentDialog";

/**
 * Тумблер «вкл/выкл» эксперимента (spec 0046, 0050): включение — сразу, выключение — через окно с причиной,
 * контрольный с включёнными вариантами — с обязательной галочкой. Пока запрос идёт и пока страница не перечитала
 * данные с сервера, тумблер стоит в новом положении и недоступен; ошибка — текст под тумблером, положение — с сервера.
 */
export function ExperimentEnabledSwitch({
  experiment,
  variants,
}: {
  experiment: { id: string; name: string; enabled: boolean };
  /** Включённые варианты, если это контрольный: их список и галочка — в окне выключения. */
  variants: readonly string[];
}) {
  const queryClient = useQueryClient();
  const enable = useSetExperimentEnabled();
  const [disabling, setDisabling] = useState(false);
  // Новое положение до перечитывания данных страницы: мутация инвалидирует ["experiments"], ждём этот запрос.
  const [settling, setSettling] = useState<boolean | null>(null);
  const { id, enabled } = experiment;

  const settle = (next: boolean) => {
    setSettling(next);
    void queryClient
      .invalidateQueries(
        { queryKey: experimentsQueryKey },
        { cancelRefetch: false },
      )
      .finally(() => setSettling(null));
  };

  const change = (checked: boolean) => {
    enable.reset();
    if (!checked) {
      setDisabling(true);
      return;
    }
    enable.mutate({ id, enabled: true }, { onSuccess: () => settle(true) });
  };

  return (
    <div className="inline-flex flex-col items-center gap-0.5">
      <Switch
        checked={enable.isPending ? true : (settling ?? enabled)}
        disabled={enable.isPending || settling !== null}
        aria-label={`Эксперимент ${id}`}
        title={enabled ? "Выключить эксперимент" : "Включить эксперимент"}
        onCheckedChange={change}
      />
      {enable.error && (
        <span className="max-w-40 text-[10px] leading-tight text-destructive">
          {enable.error.message}
        </span>
      )}
      {disabling && (
        <DisableExperimentDialog
          experiment={experiment}
          variants={variants}
          onDisabled={() => settle(false)}
          onClose={() => setDisabling(false)}
        />
      )}
    </div>
  );
}
