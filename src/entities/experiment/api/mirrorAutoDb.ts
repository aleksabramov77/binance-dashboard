import { marketSchema } from "@binance-dashboard/trading-core";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { DEMO_MIRROR_MARKETS, type Market } from "../model/assetGroup";
import { experimentsTable, paperTradesTable, runsTable } from "../model/db";
import {
  type DemoMirrorMode,
  type MirrorAdvice,
  type MirrorAutoSnapshot,
  mirrorAutoSnapshotSchema,
} from "../model/mirrorAuto";

// Авто-зеркало в БД (spec 0043): положение переключателя, данные для решения автомата и запись решения.
// Само решение — чистая функция (lib/decideMirrorAuto.ts), композиция — src/app/server/mirrorAuto.ts.

type Db = PgDatabase<PgQueryResultHKT>;

/** Закрытая paper-сделка текущей эпохи с R (сделки без стопа R не имеют и автомат их не считает). */
export interface MirrorAutoTrade {
  openedAt: Date;
  rMultiple: number;
}

/** Эксперимент для решения автомата: положение, флаги, начала окна и закрытые сделки эпохи по порядку закрытия. */
export interface MirrorAutoRow {
  id: string;
  market: Market;
  enabled: boolean;
  demoMirror: boolean;
  mode: DemoMirrorMode;
  advice: MirrorAdvice | null;
  /** Прежний снимок авто-зеркала (последнее изменение переносится в новый); null — нет или битый. */
  auto: MirrorAutoSnapshot | null;
  resetAt: Date | null;
  since: Date | null;
  trades: MirrorAutoTrade[];
}

const parseSnapshot = (raw: unknown): MirrorAutoSnapshot | null => {
  const parsed = mirrorAutoSnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/**
 * Эксперименты групп с демо-зеркалом (COIN-M автомат не трогает) и их закрытые сделки текущей эпохи с R.
 * ids — только эти эксперименты (перевод в «Авто»). null — эпохи ещё нет.
 */
export async function readMirrorAutoRows(
  db: Db,
  ids?: string[],
): Promise<{ runStartedAt: Date; rows: MirrorAutoRow[] } | null> {
  const [run] = await db
    .select()
    .from(runsTable)
    .orderBy(desc(runsTable.id))
    .limit(1);
  if (!run) return null;
  const experiments = await db
    .select()
    .from(experimentsTable)
    .where(
      and(
        inArray(experimentsTable.market, [...DEMO_MIRROR_MARKETS]),
        ids ? inArray(experimentsTable.id, ids) : undefined,
      ),
    )
    .orderBy(asc(experimentsTable.id));
  if (!experiments.length) return { runStartedAt: run.startedAt, rows: [] };
  const trades = await db
    .select({
      experimentId: paperTradesTable.experimentId,
      openedAt: paperTradesTable.openedAt,
      rMultiple: paperTradesTable.rMultiple,
    })
    .from(paperTradesTable)
    .where(
      and(
        eq(paperTradesTable.runId, run.id),
        inArray(
          paperTradesTable.experimentId,
          experiments.map((e) => e.id),
        ),
        isNotNull(paperTradesTable.closedAt),
        isNotNull(paperTradesTable.rMultiple),
      ),
    )
    .orderBy(asc(paperTradesTable.closedAt), asc(paperTradesTable.id));
  const byExperiment = new Map<string, MirrorAutoTrade[]>();
  for (const t of trades) {
    if (t.rMultiple === null) continue;
    const list = byExperiment.get(t.experimentId) ?? [];
    list.push({ openedAt: t.openedAt, rMultiple: t.rMultiple });
    byExperiment.set(t.experimentId, list);
  }
  return {
    runStartedAt: run.startedAt,
    rows: experiments.map((e) => ({
      id: e.id,
      market: marketSchema.parse(e.market),
      enabled: e.enabled,
      demoMirror: e.demoMirror,
      mode: e.demoMirrorMode,
      advice: e.demoMirrorAdvice ?? null,
      auto: parseSnapshot(e.demoMirrorAuto),
      resetAt: e.resetAt,
      since: e.demoMirrorSince,
      trades: byExperiment.get(e.id) ?? [],
    })),
  };
}

/**
 * Положение переключателя: `on` / `off` ставят и флаг зеркала (начало окна — сейчас, если флаг изменился), `auto` —
 * только положение (решает автомат). Смена положения сбрасывает последнюю подсказку — она может прийти снова.
 * `on` — только в группе с демо-зеркалом (COIN-M — false, как и неизвестный id).
 */
export async function setExperimentMirrorMode(
  db: Db,
  id: string,
  mode: DemoMirrorMode,
): Promise<boolean> {
  const flag = mode === "auto" ? null : mode === "on";
  const rows = await db
    .update(experimentsTable)
    .set({
      demoMirrorMode: mode,
      ...(flag !== null && {
        demoMirror: flag,
        demoMirrorSince: sql`case when ${experimentsTable.demoMirror} = ${flag} then ${experimentsTable.demoMirrorSince} else now() end`,
      }),
      demoMirrorAdvice: sql`case when ${experimentsTable.demoMirrorMode} = ${mode} then ${experimentsTable.demoMirrorAdvice} else null end`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(experimentsTable.id, id),
        mode === "on"
          ? inArray(experimentsTable.market, [...DEMO_MIRROR_MARKETS])
          : undefined,
      ),
    )
    .returning({ id: experimentsTable.id });
  return rows.length > 0;
}

/** Что записать по решению автомата: флаг зеркала, снимок решения для UI, последняя подсказка. */
export interface MirrorAutoPatch {
  demoMirror?: boolean;
  snapshot?: MirrorAutoSnapshot;
  advice?: MirrorAdvice | null;
}

/**
 * Запись решения автомата. Пишется, только если положение всё ещё `mode` (переключатель могли сменить, пока шла
 * проверка); смена флага — ещё и только если он другой (начало окна — сейчас). false — ничего не записано.
 */
export async function saveMirrorAuto(
  db: Db,
  id: string,
  mode: DemoMirrorMode,
  patch: MirrorAutoPatch,
): Promise<boolean> {
  const rows = await db
    .update(experimentsTable)
    .set({
      ...(patch.demoMirror !== undefined && {
        demoMirror: patch.demoMirror,
        demoMirrorSince: sql`now()`,
        updatedAt: sql`now()`,
      }),
      ...(patch.snapshot && { demoMirrorAuto: { ...patch.snapshot } }),
      ...(patch.advice !== undefined && { demoMirrorAdvice: patch.advice }),
    })
    .where(
      and(
        eq(experimentsTable.id, id),
        eq(experimentsTable.demoMirrorMode, mode),
        patch.demoMirror !== undefined
          ? sql`${experimentsTable.demoMirror} <> ${patch.demoMirror}`
          : undefined,
      ),
    )
    .returning({ id: experimentsTable.id });
  return rows.length > 0;
}
