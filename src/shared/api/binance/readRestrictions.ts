import { z } from "zod";
import {
  type FlagRule,
  LIVE_FLAG_RULES,
  LIVE_KEY_FLAGS,
  type LiveKeyFlag,
  liveKeyFlagsSchema,
} from "./liveRestrictions";

// Права read-only ключа основного аккаунта (spec 0065): тот же ответ GET /sapi/v1/account/apiRestrictions и те же
// флаги, что у торгового ключа воркера (liveRestrictions.ts), плюс опционы и Portfolio Margin; правила другие — ключ
// только для чтения. Правила воркера не меняются. Клиент-безопасно: карточка «Настройки» показывает права по этим правилам.

/** Флаги read-only ключа: флаги воркера + торговля опционами и Portfolio Margin. Порядок — порядок строк в карточке. */
export const READ_KEY_FLAGS = [
  ...LIVE_KEY_FLAGS,
  "enableVanillaOptions",
  "enablePortfolioMarginTrading",
] as const;
export type ReadKeyFlag = (typeof READ_KEY_FLAGS)[number];

/**
 * Флаги воркера обязательны (нет поля — «неизвестный ответ»); опционы и Portfolio Margin Binance присылает не всегда —
 * нет поля, значит выключено.
 */
export const readKeyFlagsSchema = liveKeyFlagsSchema.extend({
  enableVanillaOptions: z.boolean().default(false),
  enablePortfolioMarginTrading: z.boolean().default(false),
}) satisfies z.ZodType<Record<ReadKeyFlag, boolean>>;
export type ReadKeyFlags = z.infer<typeof readKeyFlagsSchema>;

const rule = (
  flag: LiveKeyFlag,
  expected: boolean,
  problem: string,
): FlagRule => ({ expected, label: LIVE_FLAG_RULES[flag].label, problem });

/** Что нужно у read-only ключа: чтение и ограничение по IP включены, всё остальное выключено. Без предупреждений. */
export const READ_KEY_FLAG_RULES: Record<ReadKeyFlag, FlagRule> = {
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
  enableVanillaOptions: {
    expected: false,
    label: "Enable Vanilla Options",
    problem:
      "у ключа разрешена торговля опционами — выключите «Enable Vanilla Options»",
  },
  enablePortfolioMarginTrading: {
    expected: false,
    label: "Enable Portfolio Margin Trading",
    problem:
      "у ключа разрешена торговля Portfolio Margin — выключите «Enable Portfolio Margin Trading»",
  },
};

export interface ReadKeyVerdict {
  ok: boolean;
  /** Прочитанные права; null — ответ не распознан. */
  flags: ReadKeyFlags | null;
  /** Причины отказа — по каждому нарушенному пункту. */
  reasons: string[];
}

/** Годится ли ключ «только чтение»: любое нарушение или неизвестный ответ — отказ с причинами. */
export function evaluateReadKeyRestrictions(raw: unknown): ReadKeyVerdict {
  const parsed = readKeyFlagsSchema.safeParse(raw);
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
  const reasons = READ_KEY_FLAGS.filter(
    (flag) => flags[flag] !== READ_KEY_FLAG_RULES[flag].expected,
  ).map((flag) => READ_KEY_FLAG_RULES[flag].problem);
  return { ok: reasons.length === 0, flags, reasons };
}
