import { z } from "zod";
import { readKeyFlagsSchema } from "@/shared/api/binance";

// Ключ основного аккаунта Binance (spec 0065): ввод, статус для карточки «Настройки», ответ об отказе. Ни ключа, ни
// секрета в статусе и ответах нет — только последние 4 символа API Key.

/** Имя записи в account_keys и AAD шифрования. */
export const MAIN_ACCOUNT_KEY_NAME = "binance-main";

// Ключи Binance (HMAC) — 64 латинские буквы и цифры. Сообщения схемы не повторяют введённое значение.
const credential = (label: string) =>
  z
    .string({ error: `Вставьте ${label}` })
    .trim()
    .min(1, `Вставьте ${label}`)
    .min(16, `${label} слишком короткий — вставьте целиком`)
    .max(256, `${label} слишком длинный`)
    .regex(/^[A-Za-z0-9]+$/, `${label}: только латинские буквы и цифры`);

/** Тело PUT /api/account-key. */
export const accountKeyInputSchema = z.strictObject({
  apiKey: credential("API Key"),
  apiSecret: credential("Secret Key"),
});
export type AccountKeyInput = z.infer<typeof accountKeyInputSchema>;

/** Откуда приложение берёт ключ сейчас: база, env (.env.local) или ключа нет. */
export const ACCOUNT_KEY_SOURCES = ["db", "env", "none"] as const;
export type AccountKeySource = (typeof ACCOUNT_KEY_SOURCES)[number];

export const accountKeyStatusSchema = z.object({
  source: z.enum(ACCOUNT_KEY_SOURCES),
  /** Сохранённый в базе ключ (даже если не расшифровывается); null — в базе ключа нет. */
  stored: z
    .object({
      /** Последние 4 символа API Key. */
      hint: z.string(),
      savedAt: z.iso.datetime(),
      /** Права на момент проверки; null — запись старого формата. */
      flags: readKeyFlagsSchema.nullable(),
    })
    .nullable(),
  /** Ключ в базе есть, мастер-ключ читается, но не подходит (сменился) — ключ надо ввести заново. */
  decryptFailed: z.boolean(),
  /**
   * Ключ в базе есть, а мастер-ключ на сервере не читается (нет SECRETS_KEY_FILE, файла, прав) — причина. Запись цела,
   * после исправления на сервере снова работает; null — не тот случай.
   */
  masterUnavailable: z.string().nullable(),
  /** Можно ли ввести ключ на сайте; нет — причина (на сервере не задан мастер-ключ). */
  input: z.object({ available: z.boolean(), reason: z.string().nullable() }),
  hosting: z.enum(["local", "cloud"]),
});
export type AccountKeyStatus = z.infer<typeof accountKeyStatusSchema>;

/** Ответ PUT при отказе: причины по правам или ошибка Binance; флаги — если Binance их прислал. */
export const accountKeyRejectionSchema = z.object({
  error: z.string(),
  reasons: z.array(z.string()).default([]),
  flags: readKeyFlagsSchema.nullable().default(null),
});
export type AccountKeyRejection = z.infer<typeof accountKeyRejectionSchema>;
