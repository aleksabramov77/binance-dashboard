// Чистая часть `pnpm lab:private` (scripts/lab-private.ts, spec 0015): разбор private/experiments.json, проверки id
// и план записи против строк БД. Без fs, сети и БД — файл, каталог и строки передаёт CLI.
import { isDeepStrictEqual } from "node:util";
import {
  type Experiment,
  type ExperimentMarket,
  experimentSchema,
} from "@binance-dashboard/trading-core";
import { z } from "zod";

/** Как у каталога (features/paper-engine): стартовый бюджет, включён, без demo-зеркала. */
export const PRIVATE_DEFAULTS = {
  initialBudget: 10_000,
  enabled: true,
  demoMirror: false,
} as const;

/** P + буква рынка + номер: PS01 — spot, PF01 — futures. Не пересекается с id каталога (S.., F..). */
export const PRIVATE_ID_PATTERN = /^P([SF])\d{2,}$/;
const PREFIX_MARKET: Record<string, ExperimentMarket> = {
  S: "spot",
  F: "futures",
};

/**
 * Эксперимент в private/experiments.json: формат каталога, необязательные поля — с дефолтами каталога.
 * Лишние поля верхнего уровня — ошибка: опечатка в имени поля не должна молча теряться.
 */
export const privateExperimentSchema = z.strictObject({
  ...experimentSchema.shape,
  name: z.string().trim().min(1),
  hypothesis: z.string().trim().min(1),
  initialBudget: experimentSchema.shape.initialBudget.default(
    PRIVATE_DEFAULTS.initialBudget,
  ),
  enabled: experimentSchema.shape.enabled.default(PRIVATE_DEFAULTS.enabled),
  demoMirror: experimentSchema.shape.demoMirror.default(
    PRIVATE_DEFAULTS.demoMirror,
  ),
});

export type ParseResult =
  | { ok: true; experiments: Experiment[] }
  | { ok: false; errors: string[] };

const label = (index: number, id: unknown) =>
  typeof id === "string" && id ? id : `#${index + 1} (без id)`;

const fieldPath = (path: readonly PropertyKey[]) =>
  path.length ? path.map(String).join(".") : "(весь объект)";

/**
 * Текст файла → эксперименты с дефолтами или список ошибок (каждая — какой эксперимент и какое поле).
 * Ошибки собираются все сразу, чтобы чинить файл за один проход.
 */
export function parsePrivateExperiments(
  text: string,
  catalogIds: ReadonlySet<string>,
): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `невалидный JSON: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (!Array.isArray(raw))
    return {
      ok: false,
      errors: ["ожидается массив экспериментов: [ { id, market, … } ]"],
    };

  const errors: string[] = [];
  const experiments: Experiment[] = [];
  const seen = new Set<string>();
  raw.forEach((item: unknown, index) => {
    const id =
      item && typeof item === "object" ? (item as { id?: unknown }).id : null;
    const who = label(index, id);
    const parsed = privateExperimentSchema.safeParse(item);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        errors.push(`${who}: поле ${fieldPath(issue.path)} — ${issue.message}`);
      return;
    }
    const e = parsed.data;
    const prefix = PRIVATE_ID_PATTERN.exec(e.id)?.[1];
    if (!prefix) {
      errors.push(
        `${who}: поле id — нужен вид PS01 (spot) или PF01 (futures): «P», буква рынка и номер`,
      );
      return;
    }
    if (PREFIX_MARKET[prefix] !== e.market) {
      errors.push(
        `${who}: поле market — префикс P${prefix} означает ${PREFIX_MARKET[prefix]}, а указано ${e.market}`,
      );
      return;
    }
    if (catalogIds.has(e.id)) {
      errors.push(`${who}: поле id — совпадает с id публичного каталога`);
      return;
    }
    if (seen.has(e.id)) {
      errors.push(`${who}: поле id — повторяется в файле`);
      return;
    }
    seen.add(e.id);
    experiments.push(e);
  });
  return errors.length ? { ok: false, errors } : { ok: true, experiments };
}

/** Поля строки experiments, которые сид обновляет (остальное — настройки пользователя). */
export interface ExistingRow {
  id: string;
  market: string;
  name: string;
  hypothesis: string;
  config: unknown;
}

export type PlanStatus = "new" | "update" | "unchanged";

export interface PlanLine {
  id: string;
  market: ExperimentMarket;
  name: string;
  status: PlanStatus;
}

/** Что сделает запись: новая строка, обновление описания/конфига или ничего. */
export function planPrivateSeed(
  experiments: readonly Experiment[],
  existing: readonly ExistingRow[],
): PlanLine[] {
  const byId = new Map(existing.map((r) => [r.id, r]));
  return experiments.map((e) => {
    const row = byId.get(e.id);
    const status: PlanStatus = !row
      ? "new"
      : row.market === e.market &&
          row.name === e.name &&
          row.hypothesis === e.hypothesis &&
          isDeepStrictEqual(row.config, e.config)
        ? "unchanged"
        : "update";
    return { id: e.id, market: e.market, name: e.name, status };
  });
}

const STATUS_TEXT: Record<PlanStatus, string> = {
  new: "новый",
  update: "обновится",
  unchanged: "без изменений",
};

export const formatPlanLine = (l: PlanLine) =>
  `${l.id.padEnd(6)} ${l.market.padEnd(8)} ${STATUS_TEXT[l.status].padEnd(14)} ${l.name}`;

/** Куда пишем — без пароля и пользователя: хост, порт и база Postgres или «локальная PGlite». */
export function describeDbTarget(
  config: { kind: "postgres"; url: string } | { kind: "pglite"; dir: string },
): string {
  if (config.kind === "pglite") return `локальная PGlite (${config.dir})`;
  try {
    const url = new URL(config.url);
    const port = url.port ? `:${url.port}` : "";
    return `Postgres ${url.hostname}${port}${url.pathname}`;
  } catch {
    return "Postgres (адрес из DATABASE_URL не разобран)";
  }
}

/** Подсказка, когда нет private/experiments.json: приватный репозиторий не склонирован. */
export const CLONE_HINT = [
  "Нет приватного репозитория. В основном checkout проекта:",
  "  git clone git@github-personal:aleksabramov77/binance-dashboard-private.git private",
  "В worktree задачи после этого: pnpm wt link (создаст ссылку private на основной checkout).",
].join("\n");
