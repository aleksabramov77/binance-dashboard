"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type AccountKeyInput,
  type AccountKeyStatus,
  accountKeyQueryKey,
  readAccountKeyResponse,
} from "@/entities/account-key";
import { EXPECTED_ERRORS_META } from "@/shared/lib";

function useAfterChange() {
  const queryClient = useQueryClient();
  return (status: AccountKeyStatus) => {
    queryClient.setQueryData(accountKeyQueryKey, status);
    // Ключ общий для «Портфеля», Earn и шапки: всё, что уже загружено без ключа (или со старым), — устарело. Ключи
    // запросов чужих доменов здесь не известны — помечаем устаревшим весь кэш, открытые страницы перезапросят.
    void queryClient.invalidateQueries();
  };
}

/** «Проверить и сохранить»: ошибка — AccountKeyError с причинами отказа. */
export function useSaveAccountKey() {
  const onSuccess = useAfterChange();
  return useMutation({
    mutationFn: (input: AccountKeyInput) =>
      fetch("/api/account-key", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }).then(readAccountKeyResponse),
    // Отказ по правам или ответ Binance — ожидаемый: причины в карточке, сервер пишет warn account-key.rejected.
    meta: EXPECTED_ERRORS_META,
    onSuccess,
  });
}

export function useDeleteAccountKey() {
  const onSuccess = useAfterChange();
  return useMutation({
    mutationFn: () =>
      fetch("/api/account-key", { method: "DELETE" }).then(
        readAccountKeyResponse,
      ),
    onSuccess,
  });
}
