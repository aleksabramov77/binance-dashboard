// Ключ основного аккаунта Binance (spec 0065): read-only ключ в базе в зашифрованном виде (AES-256-GCM), мастер-ключ —
// файл на сервере (SECRETS_KEY_FILE). Композиция платформы: база, мастер-ключ, журнал и проверка прав в Binance.
// Источник ключа для «Портфеля», Earn и UID основного счёта воркера — getMainCredentials(): база → env → нет ключа.
// Ни ключ, ни секрет не попадают в журнал, ответы API и тексты ошибок — только последние 4 символа API Key.
import { z } from "zod";
import {
  type AccountKeyInput,
  type AccountKeyRow,
  type AccountKeyStatus,
  deleteAccountKeyRow,
  keyHint,
  loadAccountKeyRow,
  MAIN_ACCOUNT_KEY_NAME,
  saveAccountKeyRow,
  scrubSecrets,
} from "@/entities/account-key";
import {
  evaluateReadKeyRestrictions,
  isKeyRejected,
  KEY_REJECTED_REASON,
  type ReadKeyFlags,
  readKeyFlagsSchema,
} from "@/shared/api/binance";
import {
  BinanceApiError,
  fetchApiRestrictions,
} from "@/shared/api/binance/account.server";
import {
  type AccountKeyFixture,
  type BinanceCredentials,
  getAccountKeyFixture,
  getAppHost,
  getBinanceCredentials,
  getSecretsKeyFile,
} from "@/shared/config/env.server";
import {
  decrypt,
  encrypt,
  readMasterKeyFile,
} from "@/shared/crypto/aesGcm.server";
import { getDb } from "@/shared/db/client.server";
import { log } from "@/shared/lib/logger.server";

const NAME = MAIN_ACCOUNT_KEY_NAME;

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

type MasterKey = { key: Buffer; reason: null } | { key: null; reason: string };

/** Мастер-ключ читается при каждом промахе кэша ключа: файл маленький, промахи редки (сохранение, удаление, старт). */
function loadMasterKey(): MasterKey {
  const file = getSecretsKeyFile();
  if (!file)
    return {
      key: null,
      reason: "на сервере не задан мастер-ключ (SECRETS_KEY_FILE)",
    };
  try {
    return { key: readMasterKeyFile(file), reason: null };
  } catch (error) {
    return { key: null, reason: message(error) };
  }
}

interface Resolved {
  creds: BinanceCredentials | null;
  source: AccountKeyStatus["source"];
  decryptFailed: boolean;
  /** Ключ в базе есть, а мастер-ключ не читается (нет SECRETS_KEY_FILE, файла, прав): причина; иначе null. */
  masterUnavailable: string | null;
}

// Кэш в процессе: в dev роуты и instrumentation — разные бандлы, поэтому в globalThis. Сбрасывается при сохранении
// и удалении — «Портфель» и Earn берут новый ключ без перезапуска сервиса.
const cacheKey = Symbol.for("binance-dashboard.mainAccountKey");
/** Уже записали «мастер-ключ недоступен» (один раз на процесс, до восстановления). */
const masterWarnKey = Symbol.for(
  "binance-dashboard.mainAccountKeyMasterWarned",
);
const g = globalThis as typeof globalThis & {
  [cacheKey]?: Resolved;
  [masterWarnKey]?: boolean;
};

/** Для тестов и после записи: забыть ключ процесса. */
export function resetMainCredentialsCache(): void {
  delete g[cacheKey];
  delete g[masterWarnKey];
}

/** Что лежит в шифротексте. */
const sealedCredsSchema = z.object({
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
});

function decryptRow(row: AccountKeyRow, key: Buffer): BinanceCredentials {
  const plaintext = decrypt(
    key,
    { iv: row.iv, tag: row.tag, ciphertext: row.ciphertext },
    NAME,
  );
  let json: unknown;
  try {
    json = JSON.parse(plaintext);
  } catch {
    // Текст ошибки JSON.parse цитирует начало открытого текста — свой текст без него.
    throw new Error("расшифрованная запись не распознана (не JSON)");
  }
  const parsed = sealedCredsSchema.safeParse(json);
  if (!parsed.success) throw new Error("расшифрованная запись не распознана");
  return parsed.data;
}

function resolve(): Resolved {
  const cached = g[cacheKey];
  if (cached) return cached;
  let row: AccountKeyRow | null;
  try {
    row = loadAccountKeyRow(getDb(), NAME);
  } catch (error) {
    // База недоступна — ключ из env, без кэша: следующий вызов прочитает базу снова.
    log.debug(
      "account-key.read",
      "Ключ основного аккаунта не прочитан из базы",
      {
        error: message(error),
      },
    );
    const creds = getBinanceCredentials();
    return {
      creds,
      source: creds ? "env" : "none",
      decryptFailed: false,
      masterUnavailable: null,
    };
  }
  let decryptFailed = false;
  if (row) {
    const master = loadMasterKey();
    if (!master.key) {
      // Мастер-ключ не читается (env, путь, права) — запись цела, это не «ключ не подходит»: decrypt-failed не пишем,
      // ничего не удаляем и не кэшируем — после исправления на сервере ключ снова заработает без ввода.
      if (!g[masterWarnKey])
        log.warn(
          "account-key.master-unavailable",
          "Мастер-ключ недоступен — сохранённый ключ основного аккаунта не используется до исправления на сервере",
          { hint: row.keyHint, reason: master.reason },
        );
      g[masterWarnKey] = true;
      const creds = getBinanceCredentials();
      return {
        creds,
        source: creds ? "env" : "none",
        decryptFailed: false,
        masterUnavailable: master.reason,
      };
    }
    g[masterWarnKey] = false;
    try {
      const resolved: Resolved = {
        creds: decryptRow(row, master.key),
        source: "db",
        decryptFailed: false,
        masterUnavailable: null,
      };
      g[cacheKey] = resolved;
      return resolved;
    } catch (error) {
      // Одна запись на процесс: итог кэшируется до сохранения или удаления ключа.
      decryptFailed = true;
      log.error(
        "account-key.decrypt-failed",
        "Сохранённый ключ основного аккаунта не расшифровывается — введите его заново в «Настройках»",
        { hint: row.keyHint, reason: message(error) },
      );
    }
  }
  const creds = getBinanceCredentials();
  const resolved: Resolved = {
    creds,
    source: creds ? "env" : "none",
    decryptFailed,
    masterUnavailable: null,
  };
  g[cacheKey] = resolved;
  return resolved;
}

/**
 * Read-only ключ основного аккаунта: база (расшифрованный) → env (BINANCE_API_KEY, локально) → null. Синхронный
 * (better-sqlite3). Не расшифровался — как «ключа в базе нет» и одна запись account-key.decrypt-failed.
 */
export function getMainCredentials(): BinanceCredentials | null {
  return resolve().creds;
}

const hosting = (): AccountKeyStatus["hosting"] =>
  getAppHost() === "local" ? "local" : "cloud";

const storedFlags = (row: AccountKeyRow): ReadKeyFlags | null => {
  const parsed = readKeyFlagsSchema.safeParse(row.restrictions);
  return parsed.success ? parsed.data : null;
};

/** Статус для карточки и GET /api/account-key — без ключа и секрета. */
export function getAccountKeyStatus(): AccountKeyStatus {
  const resolved = resolve();
  const row = loadAccountKeyRow(getDb(), NAME);
  const master = loadMasterKey();
  return {
    source: resolved.source,
    stored: row
      ? {
          hint: row.keyHint,
          savedAt: row.savedAt.toISOString(),
          flags: storedFlags(row),
        }
      : null,
    decryptFailed: resolved.decryptFailed,
    masterUnavailable: row ? resolved.masterUnavailable : null,
    input: { available: master.key !== null, reason: master.reason },
    hosting: hosting(),
  };
}

// Заглушка Binance для локальной проверки (ACCOUNT_KEY_FIXTURE, только Mac и не production).
const FIXTURE_FLAGS: Record<
  Exclude<AccountKeyFixture, "rejected">,
  ReadKeyFlags
> = {
  "read-only": {
    ipRestrict: true,
    enableReading: true,
    enableSpotAndMarginTrading: false,
    enableFutures: false,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    permitsUniversalTransfer: false,
    enableMargin: false,
    enableVanillaOptions: false,
    enablePortfolioMarginTrading: false,
  },
  trading: {
    ipRestrict: false,
    enableReading: true,
    enableSpotAndMarginTrading: true,
    enableFutures: true,
    enableWithdrawals: true,
    enableInternalTransfer: false,
    permitsUniversalTransfer: false,
    enableMargin: false,
    enableVanillaOptions: false,
    enablePortfolioMarginTrading: false,
  },
};

function fixtureRestrictions(fixture: AccountKeyFixture): Promise<unknown> {
  if (fixture === "rejected")
    return Promise.reject(
      new BinanceApiError(
        "Binance: Invalid API-key, IP, or permissions for action. (-2015)",
        -2015,
        401,
      ),
    );
  return Promise.resolve(FIXTURE_FLAGS[fixture]);
}

export interface AccountKeyDeps {
  /** Права ключа в Binance (apiRestrictions); в тестах — заглушка. */
  fetchRestrictions: (creds: BinanceCredentials) => Promise<unknown>;
  now: () => Date;
}

const defaultDeps = (): AccountKeyDeps => {
  const fixture = getAccountKeyFixture();
  return {
    fetchRestrictions: fixture
      ? () => fixtureRestrictions(fixture)
      : fetchApiRestrictions,
    now: () => new Date(),
  };
};

export type SaveAccountKeyResult =
  | { ok: true; status: AccountKeyStatus }
  | {
      ok: false;
      status: number;
      error: string;
      reasons: string[];
      flags: ReadKeyFlags | null;
    };

/**
 * «Проверить и сохранить»: права ключа в Binance → только чтение и IP — шифрование и запись в базу, иначе отказ с
 * причинами. Binance не ответил или отклонил ключ — тоже не сохраняется.
 */
export async function saveAccountKey(
  input: AccountKeyInput,
  context: { by: string | null },
  deps: AccountKeyDeps = defaultDeps(),
): Promise<SaveAccountKeyResult> {
  const master = loadMasterKey();
  if (!master.key)
    return {
      ok: false,
      status: 409,
      error: `Ввод ключа недоступен: ${master.reason}`,
      reasons: [],
      flags: null,
    };
  const creds: BinanceCredentials = {
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
  };
  const hint = keyHint(input.apiKey);
  const scrub = (text: string) =>
    scrubSecrets(text, [input.apiKey, input.apiSecret]);
  const reject = (
    status: number,
    error: string,
    reasons: string[],
    flags: ReadKeyFlags | null,
    detail = error,
  ): SaveAccountKeyResult => {
    log.warn("account-key.rejected", `Ключ …${hint} не сохранён: ${detail}`, {
      hint,
      reasons,
      by: context.by,
    });
    return { ok: false, status, error, reasons, flags };
  };

  let raw: unknown;
  try {
    raw = await deps.fetchRestrictions(creds);
  } catch (error) {
    const text = scrub(message(error));
    if (error instanceof BinanceApiError && isKeyRejected(error))
      return reject(
        422,
        `Binance отклонил ключ: ${text}`,
        [KEY_REJECTED_REASON],
        null,
      );
    // Сеть, пауза после 429/418, 5xx — ключ не проверен, повторить позже.
    return reject(502, `Binance не ответил: ${text}`, [], null);
  }

  const verdict = evaluateReadKeyRestrictions(raw);
  if (!verdict.ok || !verdict.flags)
    return reject(
      422,
      "Ключ не сохранён: права не подходят для ключа «только чтение»",
      verdict.reasons,
      verdict.flags,
      "права не подходят для ключа «только чтение»",
    );

  const sealed = encrypt(master.key, JSON.stringify(creds), NAME);
  saveAccountKeyRow(getDb(), {
    name: NAME,
    ...sealed,
    keyHint: hint,
    restrictions: verdict.flags,
    savedAt: deps.now(),
  });
  resetMainCredentialsCache();
  log.info("account-key.saved", `Ключ основного аккаунта …${hint} сохранён`, {
    hint,
    flags: verdict.flags,
    by: context.by,
  });
  return { ok: true, status: getAccountKeyStatus() };
}

/** «Удалить ключ»: запись стирается, «Портфель» снова без ключа (или с ключом из env локально). */
export function deleteAccountKey(context: {
  by: string | null;
}): AccountKeyStatus {
  const removed = deleteAccountKeyRow(getDb(), NAME);
  resetMainCredentialsCache();
  if (removed)
    log.info(
      "account-key.deleted",
      `Ключ основного аккаунта …${removed.keyHint} удалён`,
      { hint: removed.keyHint, by: context.by },
    );
  return getAccountKeyStatus();
}
