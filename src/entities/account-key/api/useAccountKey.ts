"use client";

import { useQuery } from "@tanstack/react-query";
import { readAccountKeyResponse } from "../lib/response";

export const accountKeyQueryKey = ["account-key", "status"] as const;

/** Статус ключа основного аккаунта для карточки «Настройки». */
export function useAccountKeyStatus() {
  return useQuery({
    queryKey: accountKeyQueryKey,
    queryFn: () =>
      fetch("/api/account-key", { cache: "no-store" }).then(
        readAccountKeyResponse,
      ),
    retry: 1,
  });
}
