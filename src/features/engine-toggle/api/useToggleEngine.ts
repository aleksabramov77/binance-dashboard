"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type EngineStatus,
  engineStatusQueryKey,
  experimentBudgetsQueryKey,
  readEngineStatus,
} from "@/entities/experiment";

/** Тумблер «Автоторговля» лаборатории: оптимистично переключаем, при ошибке откатываем. */
export function useToggleEngine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      fetch("/api/experiments/engine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled }),
      }).then(readEngineStatus),
    onMutate: async (enabled) => {
      await queryClient.cancelQueries({ queryKey: engineStatusQueryKey });
      const previous =
        queryClient.getQueryData<EngineStatus>(engineStatusQueryKey);
      if (previous)
        queryClient.setQueryData<EngineStatus>(engineStatusQueryKey, {
          ...previous,
          enabled,
        });
      return { previous };
    },
    onError: (_error, _enabled, context) => {
      if (context?.previous)
        queryClient.setQueryData(engineStatusQueryKey, context.previous);
    },
    onSuccess: (status) => {
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
