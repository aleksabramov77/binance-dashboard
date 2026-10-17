// Ключ основного аккаунта Binance (spec 0065, платформа): read-only ключ хранится в базе в зашифрованном виде. Общий
// ресурс для «Портфеля», Earn и воркера реального счёта — композиция в src/app/server/accountKey.ts (getMainCredentials).

// Только сервер: чтение и запись зашифрованной записи (вызывает композиция).
export {
  type AccountKeyRow,
  deleteAccountKeyRow,
  loadAccountKeyRow,
  saveAccountKeyRow,
} from "./api/accountKeyDb";
export {
  AccountKeyError,
  accountKeyQueryKey,
  readAccountKeyResponse,
  useAccountKeyStatus,
} from "./api/useAccountKey";
export { hintText, keyHint, scrubSecrets } from "./lib/hint";
// Таблица (Drizzle) — запросы делает сервер через shared/db.
export { accountKeysTable } from "./model/db";
export {
  ACCOUNT_KEY_SOURCES,
  type AccountKeyInput,
  type AccountKeyRejection,
  type AccountKeySource,
  type AccountKeyStatus,
  accountKeyInputSchema,
  accountKeyRejectionSchema,
  accountKeyStatusSchema,
  MAIN_ACCOUNT_KEY_NAME,
} from "./model/schema";
