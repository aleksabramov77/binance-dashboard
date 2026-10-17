import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

// AES-256-GCM для секретов в базе (spec 0065). Только сервер: node:crypto. Чистые функции — мастер-ключ передаётся
// аргументом. AAD — имя записи: шифротекст одной записи нельзя подставить в другую, расшифровка упадёт.

const ALGORITHM = "aes-256-gcm";
/** Длина мастер-ключа AES-256, байт. */
export const MASTER_KEY_BYTES = 32;
/** IV GCM — 12 байт, новый случайный на каждую запись. */
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Зашифрованная запись: всё в base64. */
export interface Sealed {
  iv: string;
  tag: string;
  ciphertext: string;
}

function assertKey(key: Buffer): void {
  if (key.length !== MASTER_KEY_BYTES)
    throw new Error(`мастер-ключ должен быть ${MASTER_KEY_BYTES} байта`);
}

export function encrypt(key: Buffer, plaintext: string, aad: string): Sealed {
  assertKey(key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/**
 * Расшифровка с проверкой тега: чужой мастер-ключ, подменённые шифротекст, тег, IV или AAD — ошибка, а не мусор.
 * Текст ошибки не содержит ни ключа, ни данных.
 */
export function decrypt(key: Buffer, sealed: Sealed, aad: string): string {
  assertKey(key);
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new Error("запись повреждена: неверная длина IV или тега");
  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "не расшифровывается: другой мастер-ключ или запись изменена",
    );
  }
}

/** Мастер-ключ из текста файла: 32 байта в base64 (`head -c 32 /dev/urandom | base64`). */
export function parseMasterKey(text: string): Buffer {
  const trimmed = text.trim();
  const key = Buffer.from(trimmed, "base64");
  // Buffer.from молча пропускает мусор — сверяем обратным кодированием.
  if (
    key.length !== MASTER_KEY_BYTES ||
    key.toString("base64") !== trimmed.replace(/\s+/g, "")
  )
    throw new Error(
      `мастер-ключ повреждён: нужно ${MASTER_KEY_BYTES} байта в base64`,
    );
  return key;
}

/** Читает мастер-ключ из файла. Ошибка — без содержимого файла. */
export function readMasterKeyFile(file: string): Buffer {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : "ошибка чтения";
    throw new Error(`мастер-ключ не прочитан: ${file}, ${code}`);
  }
  return parseMasterKey(text);
}
