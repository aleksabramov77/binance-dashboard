"use client";

import { useQuery } from "@tanstack/react-query";
import {
  type AccountKeyStatus,
  accountKeyRejectionSchema,
  accountKeyStatusSchema,
} from "../model/schema";

export const accountKeyQueryKey = ["account-key", "status"] as const;

/** Ошибка API ключа: текст и причины отказа (права ключа, ответ Binance). */
export class AccountKeyError extends Error {
  constructor(
    message: string,
    readonly reasons: string[] = [],
  ) {
    super(message);
  }
}

/** Ответ GET/PUT/DELETE /api/account-key → статус или AccountKeyError с причинами. */
export async function readAccountKeyResponse(
  res: Response,
): Promise<AccountKeyStatus> {
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const rejection = accountKeyRejectionSchema.safeParse(body);
    throw rejection.success
      ? new AccountKeyError(rejection.data.error, rejection.data.reasons)
      : new AccountKeyError(`Ключ аккаунта: ошибка ${res.status}`);
  }
  return accountKeyStatusSchema.parse(body);
}

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
