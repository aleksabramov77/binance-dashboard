import { z } from "zod";

// Оценка прав торгового ключа реального счёта (spec 0047, AC2, AC3, AC8). Чистые функции и схемы: ответ
// GET /sapi/v1/account/apiRestrictions (сверено с документацией Binance 2026-10-16: вес 1 по IP, поля — булевы),
// ответы аккаунтов Spot (/api/v3/account: uid, balances) и USDⓈ-M (/fapi/v3/account: итоги счёта).
// Неизвестные поля не ломают схему; отсутствие нужного поля — блокировка.

const decimal = z.coerce.number();

/** Права ключа, которые проверяем. Порядок — порядок строк в карточке. */
export const LIVE_KEY_FLAGS = [
  "ipRestrict",
  "enableReading",
  "enableSpotAndMarginTrading",
  "enableFutures",
  "enableWithdrawals",
  "enableInternalTransfer",
  "permitsUniversalTransfer",
  "enableMargin",
] as const;
export type LiveKeyFlag = (typeof LIVE_KEY_FLAGS)[number];

export const liveKeyFlagsSchema = z.object({
  ipRestrict: z.boolean(),
  enableReading: z.boolean(),
  enableSpotAndMarginTrading: z.boolean(),
  enableFutures: z.boolean(),
  enableWithdrawals: z.boolean(),
  enableInternalTransfer: z.boolean(),
  permitsUniversalTransfer: z.boolean(),
  enableMargin: z.boolean(),
}) satisfies z.ZodType<Record<LiveKeyFlag, boolean>>;
export type LiveKeyFlags = z.infer<typeof liveKeyFlagsSchema>;

interface FlagRule {
  /** Какое значение нужно. */
  expected: boolean;
  /** Название переключателя в интерфейсе Binance (Edit restrictions). */
  label: string;
  /** Причина блокировки (или предупреждения), если значение не то. */
  problem: string;
  /** Не блокировка, а предупреждение. */
  warningOnly?: boolean;
}

export const LIVE_FLAG_RULES: Record<LiveKeyFlag, FlagRule> = {
  ipRestrict: {
    expected: true,
    label: "Restrict access to trusted IPs only",
    problem:
      "у ключа нет ограничения по IP — включите «Restrict access to trusted IPs only» с IP воркера",
  },
  enableReading: {
    expected: true,
    label: "Enable Reading",
    problem: "у ключа не включено чтение — включите «Enable Reading»",
  },
  enableSpotAndMarginTrading: {
    expected: true,
    label: "Enable Spot & Margin Trading",
    problem:
      "у ключа не включена торговля Spot — включите «Enable Spot & Margin Trading»",
  },
  enableFutures: {
    expected: true,
    label: "Enable Futures",
    problem:
      "фьючерсы недоступны: у ключа не включено «Enable Futures» (или фьючерсы не открыты на субсчёте)",
    warningOnly: true,
  },
  enableWithdrawals: {
    expected: false,
    label: "Enable Withdrawals",
    problem:
      "у ключа разрешён вывод средств — выключите «Enable Withdrawals» в настройках ключа",
  },
  enableInternalTransfer: {
    expected: false,
    label: "Enable Internal Transfer",
    problem:
      "у ключа разрешены внутренние переводы — выключите «Enable Internal Transfer»",
  },
  permitsUniversalTransfer: {
    expected: false,
    label: "Permits Universal Transfer",
    problem:
      "у ключа разрешены универсальные переводы — выключите «Permits Universal Transfer»",
  },
  enableMargin: {
    expected: false,
    label: "Enable Margin Loan, Repay & Transfer",
    problem:
      "у ключа разрешены займы и переводы маржи — выключите «Enable Margin Loan, Repay & Transfer»",
  },
};

export interface RestrictionsVerdict {
  ok: boolean;
  /** Прочитанные права; null — ответ не распознан (нет нужных полей). */
  flags: LiveKeyFlags | null;
  /** Причины блокировки — по каждому нарушенному пункту. */
  reasons: string[];
  /** Не блокирует: «фьючерсы недоступны». */
  warnings: string[];
}

/** Оценка ответа apiRestrictions: годится ли ключ. Любое нарушение или неизвестный ответ — блокировка. */
export function evaluateRestrictions(raw: unknown): RestrictionsVerdict {
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
      warnings: [],
    };
  }
  const flags = parsed.data;
  const reasons: string[] = [];
  const warnings: string[] = [];
  for (const flag of LIVE_KEY_FLAGS) {
    const rule = LIVE_FLAG_RULES[flag];
    if (flags[flag] === rule.expected) continue;
    (rule.warningOnly ? warnings : reasons).push(rule.problem);
  }
  return { ok: reasons.length === 0, flags, reasons, warnings };
}

/**
 * Binance не принял ключ: 401, -2015 (ключ, IP или права), -2014 (формат ключа), -1022 (подпись — не тот
 * секрет). Повтор не поможет — это блокировка, а не временная ошибка.
 */
export const KEY_REJECTED_CODES = [-2015, -2014, -1022] as const;

export function isKeyRejected(error: {
  status?: number;
  code?: number;
}): boolean {
  return (
    error.status === 401 ||
    (error.code !== undefined &&
      (KEY_REJECTED_CODES as readonly number[]).includes(error.code))
  );
}

export const KEY_REJECTED_REASON =
  "Binance не принял ключ: проверьте ключ и IP-whitelist";

export type UidCheckStatus = "different" | "same" | "skipped" | "pending";

/** UID основного счёта от приложения (read-only ключ): число, или null с причиной, или ещё не известен. */
export type MainAccountUid =
  | { uid: number }
  | { uid: null; reason: string }
  | undefined;

export const MAIN_ACCOUNT_REASON =
  "Это ключ основного счёта — нужен ключ субсчёта";

/** AC3: UID субсчёта ≠ UID основного счёта. Совпали — блокировка; основного UID нет — проверка пропущена. */
export function checkAccountUid(
  accountUid: number,
  main: MainAccountUid,
): { status: UidCheckStatus; note: string | null } {
  if (main === undefined)
    return {
      status: "pending",
      note: "ждём UID основного счёта от приложения",
    };
  if (main.uid === null)
    return { status: "skipped", note: `проверка пропущена: ${main.reason}` };
  return main.uid === accountUid
    ? { status: "same", note: MAIN_ACCOUNT_REASON }
    : { status: "different", note: null };
}

/** Аккаунт Spot (`/api/v3/account`): UID и остатки. */
export const liveSpotAccountSchema = z
  .object({
    uid: z.number(),
    balances: z.array(
      z.object({ asset: z.string(), free: decimal, locked: decimal }).loose(),
    ),
  })
  .loose();
export type LiveSpotAccount = z.infer<typeof liveSpotAccountSchema>;

/**
 * Аккаунт USDⓈ-M (`/fapi/v3/account`, вес 5): итоги счёта — в USDT в режиме одного актива и в USD в
 * мультиактивном режиме (по документации Binance).
 */
export const liveFuturesAccountSchema = z
  .object({
    totalWalletBalance: decimal,
    availableBalance: decimal,
    totalUnrealizedProfit: decimal,
  })
  .loose();
export type LiveFuturesAccount = z.infer<typeof liveFuturesAccountSchema>;
