import { DB_SPACE, type DbSpaceRules } from "../config/thresholds";

/**
 * Состояние порога в alert_state. sent — порог пройден, сообщение о нём больше не шлём;
 * cleared — место освободилось, порог снова может сработать.
 */
export interface SpaceAlertRow {
  key: string;
  status: "sent" | "cleared";
  title: string;
  firstSeen: string;
  lastSeen: string;
  lastSent: string | null;
}

export interface SpaceAlertPlan {
  /** Порог, о котором писать в этом прогоне (самый низкий из впервые пройденных), или null. */
  notifyThreshold: number | null;
  /** Что записать в alert_state. */
  upserts: SpaceAlertRow[];
}

export const spaceAlertTitle = (threshold: number) =>
  `Свободного места в базе ≤ ${threshold} %`;

/**
 * Без повторов: о каждом пороге — одно сообщение; если за прогон пройдено несколько — одно о самом
 * низком, остальные помечаются отправленными. Свободно больше «порог + rearmGapPct» — порог
 * перезаряжается (cleared). Чистая функция.
 */
export function planSpaceAlerts(
  freePct: number,
  previous: SpaceAlertRow[],
  now: number,
  rules: DbSpaceRules = DB_SPACE,
): SpaceAlertPlan {
  const at = new Date(now).toISOString();
  const byKey = new Map(previous.map((r) => [r.key, r]));
  const upserts: SpaceAlertRow[] = [];
  let notifyThreshold: number | null = null;

  for (const threshold of rules.thresholds) {
    const key = `${rules.keyPrefix}${threshold}`;
    const prev = byKey.get(key);
    if (freePct <= threshold) {
      if (prev?.status === "sent") continue;
      notifyThreshold = Math.min(notifyThreshold ?? threshold, threshold);
      upserts.push({
        key,
        status: "sent",
        title: spaceAlertTitle(threshold),
        firstSeen: at,
        lastSeen: at,
        lastSent: at,
      });
    } else if (
      prev?.status === "sent" &&
      freePct > threshold + rules.rearmGapPct
    ) {
      upserts.push({ ...prev, status: "cleared", lastSeen: at });
    }
  }
  return { notifyThreshold, upserts };
}
