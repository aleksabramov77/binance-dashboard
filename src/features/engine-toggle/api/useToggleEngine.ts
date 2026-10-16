"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  engineStatusQueryKey,
  experimentBudgetsQueryKey,
  readEngineStatus,
} from "@/entities/experiment";

/**
 * Тумблер «Автоторговля» лаборатории. Без оптимистичного переключения: значение меняется только после
 * подтверждения в модалке и ответа сервера (spec 0044), ошибка остаётся в модалке.
 */
export function useToggleEngine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      fetch("/api/experiments/engine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then(readEngineStatus),
    onSuccess: (status) => {
      // Общий ключ статуса: тумблер в шапке и в /settings обновляются вместе.
      queryClient.setQueryData(engineStatusQueryKey, status);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: engineStatusQueryKey });
      void queryClient.invalidateQueries({
        queryKey: experimentBudgetsQueryKey,
      });
    },
  });
}
