import { z } from "zod";

// Причина выключения эксперимента (spec 0046): категория, короткий текст и дата последнего выключения.
// Общая для /settings, API, `pnpm lab:apply` и бейджа «выключен · <категория>».

/** Категории причины: ключ хранится в experiments.disabled_reason, подпись — в интерфейсе и apply.md. */
export const DISABLE_REASONS = {
  loser: "убыточный",
  "worse-than-control": "хуже контрольного",
  duplicate: "дубль",
  "random-like": "не лучше случайного входа",
  "no-edge": "нет перевеса до комиссий",
  costs: "съедают комиссии",
  manual: "вручную / другое",
} as const;

export type DisableReason = keyof typeof DISABLE_REASONS;

export const DISABLE_REASON_KEYS = Object.keys(DISABLE_REASONS) as [
  DisableReason,
  ...DisableReason[],
];

export const disableReasonSchema = z.enum(DISABLE_REASON_KEYS);

/** Наибольшая длина текста причины. */
export const DISABLE_NOTE_MAX = 200;

export const disableNoteSchema = z.string().trim().max(DISABLE_NOTE_MAX);

/**
 * Последнее выключение для страниц. reason null — выключен до spec 0046 (или категория в БД незнакома):
 * бейдж просто «выключен».
 */
export const disabledInfoSchema = z.object({
  reason: disableReasonSchema.nullable(),
  note: z.string().nullable(),
  at: z.string().nullable(),
});
export type DisabledInfo = z.infer<typeof disabledInfoSchema>;

/** Колонки строки experiments → причина для страниц; включённый эксперимент — null. */
export function toDisabledInfo(row: {
  enabled: boolean;
  disabledReason: string | null;
  disabledNote: string | null;
  disabledAt: Date | null;
}): DisabledInfo | null {
  if (row.enabled) return null;
  const reason = disableReasonSchema.safeParse(row.disabledReason);
  return {
    reason: reason.success ? reason.data : null,
    note: row.disabledNote,
    at: row.disabledAt?.toISOString() ?? null,
  };
}

/** Форма выключения в /settings: категория обязательна, текст — до DISABLE_NOTE_MAX символов. */
export const disableFormSchema = z.object({
  reason: disableReasonSchema,
  note: disableNoteSchema,
  /** Да, выключить контрольный, хотя у него идут варианты. */
  confirmControl: z.boolean(),
});
export type DisableForm = z.infer<typeof disableFormSchema>;
