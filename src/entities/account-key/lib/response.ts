import {
  type AccountKeyStatus,
  accountKeyRejectionSchema,
  accountKeyStatusSchema,
} from "../model/schema";

/** Ошибка API ключа: текст, причины отказа (права ключа, ответ Binance) и HTTP-статус ответа. */
export class AccountKeyError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
      ? new AccountKeyError(
          rejection.data.error,
          res.status,
          rejection.data.reasons,
        )
      : new AccountKeyError(`Ключ аккаунта: ошибка ${res.status}`, res.status);
  }
  return accountKeyStatusSchema.parse(body);
}

/**
 * Ожидаемый отказ — ответ 4xx сервера (права ключа, Binance отклонил ключ, ввод недоступен, неверный ввод): причины
 * видны в карточке, сервер пишет их сам. Сеть и 5xx — сбой, его пишет общий обработчик ошибок.
 */
export const isExpectedAccountKeyRejection = (error: unknown): boolean =>
  error instanceof AccountKeyError && error.status >= 400 && error.status < 500;
