/** Пороги свободного места в базе (платформа, spec 0021). Меняются здесь — без правки логики. */
export const DB_SPACE = {
  /** Свободного места ≤ N % — одно уведомление на каждый порог. */
  thresholds: [50, 40, 30, 20, 10, 5],
  /** Порог «перезаряжается», когда свободно больше порога на столько п.п. — запас против дребезга. */
  rearmGapPct: 2,
  /** Ключи состояния в alert_state: db.space.<порог>. */
  keyPrefix: "db.space.",
  /** Сколько самых больших таблиц показывать. */
  topTables: 3,
} as const;

export type DbSpaceRules = {
  thresholds: readonly number[];
  rearmGapPct: number;
  keyPrefix: string;
};
