import {
  type FlagRule,
  LIVE_FLAG_RULES,
  LIVE_KEY_FLAGS,
  type LiveKeyFlag,
  type LiveKeyFlags,
  liveKeyFlagsSchema,
} from "./liveRestrictions";

// Права read-only ключа основного аккаунта (spec 0065): тот же ответ GET /sapi/v1/account/apiRestrictions и те же
// флаги, что у торгового ключа воркера (liveRestrictions.ts), но правила другие — ключ только для чтения. Правила
// воркера не меняются. Клиент-безопасно: карточка «Настройки» показывает права по этим правилам.

const rule = (
  flag: LiveKeyFlag,
  expected: boolean,
  problem: string,
): FlagRule => ({ expected, label: LIVE_FLAG_RULES[flag].label, problem });

/** Что нужно у read-only ключа: чтение и ограничение по IP включены, всё остальное выключено. Без предупреждений. */
export const READ_KEY_FLAG_RULES: Record<LiveKeyFlag, FlagRule> = {
  ipRestrict: rule(
    "ipRestrict",
    true,
    "у ключа нет ограничения по IP — включите «Restrict access to trusted IPs only» с IP сервера",
  ),
  enableReading: rule(
    "enableReading",
    true,
    "у ключа не включено чтение — включите «Enable Reading»",
  ),
  enableSpotAndMarginTrading: rule(
    "enableSpotAndMarginTrading",
    false,
    "у ключа разрешена торговля Spot и Margin — выключите «Enable Spot & Margin Trading»",
  ),
  enableFutures: rule(
    "enableFutures",
    false,
    "у ключа разрешена торговля фьючерсами — выключите «Enable Futures»",
  ),
  enableWithdrawals: rule(
    "enableWithdrawals",
    false,
    "у ключа разрешён вывод средств — выключите «Enable Withdrawals»",
  ),
  enableInternalTransfer: rule(
    "enableInternalTransfer",
    false,
    "у ключа разрешены внутренние переводы — выключите «Enable Internal Transfer»",
  ),
  permitsUniversalTransfer: rule(
    "permitsUniversalTransfer",
    false,
    "у ключа разрешены универсальные переводы — выключите «Permits Universal Transfer»",
  ),
  enableMargin: rule(
    "enableMargin",
    false,
    "у ключа разрешены займы и переводы маржи — выключите «Enable Margin Loan, Repay & Transfer»",
  ),
};

export interface ReadKeyVerdict {
  ok: boolean;
  /** Прочитанные права; null — ответ не распознан. */
  flags: LiveKeyFlags | null;
  /** Причины отказа — по каждому нарушенному пункту. */
  reasons: string[];
}

/** Годится ли ключ «только чтение»: любое нарушение или неизвестный ответ — отказ с причинами. */
export function evaluateReadKeyRestrictions(raw: unknown): ReadKeyVerdict {
  const parsed = liveKeyFlagsSchema.safeParse(raw);
  if (!parsed.success) {
    const missing = [
      ...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "ответ"))),
    ];
    return {
      ok: false,
      flags: null,
      reasons: [
        `Binance вернул неизвестный ответ о правах ключа (нет или не так: ${missing.join(", ")})`,
      ],
    };
  }
  const flags = parsed.data;
  const reasons = LIVE_KEY_FLAGS.filter(
    (flag) => flags[flag] !== READ_KEY_FLAG_RULES[flag].expected,
  ).map((flag) => READ_KEY_FLAG_RULES[flag].problem);
  return { ok: reasons.length === 0, flags, reasons };
}
