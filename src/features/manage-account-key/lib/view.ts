import type { AccountKeyStatus } from "@/entities/account-key";

/**
 * Что показывает карточка:
 * - `saved` — ключ в базе работает: статус, «Заменить», «Удалить»;
 * - `master-unavailable` — ключ в базе цел, но мастер-ключ на сервере не читается: только объяснение, без формы и
 *   без «Удалить» (после исправления на сервере ключ заработает сам);
 * - `decrypt-failed` — мастер-ключ читается, но не подходит: ввести ключ заново (форма и «Удалить»);
 * - `empty` — ключа в базе нет: форма.
 */
export type AccountKeyView =
  | "saved"
  | "master-unavailable"
  | "decrypt-failed"
  | "empty";

export function accountKeyView(status: AccountKeyStatus): AccountKeyView {
  if (!status.stored) return "empty";
  if (status.masterUnavailable !== null) return "master-unavailable";
  if (status.decryptFailed) return "decrypt-failed";
  return "saved";
}
