// Чистая часть `pnpm lab:private` (scripts/lab-private.ts, spec 0015): разбор private/experiments.json, проверки id
// и план записи против строк БД. Без fs, сети и БД — файл, каталог и строки передаёт CLI.
import { isDeepStrictEqual } from "node:util";
import {
  type Experiment,
  type ExperimentMarket,
  experimentSchema,
  legacyMarketSchema,
} from "@binance-dashboard/trading-core";
import { z } from "zod";
import { ASSET_GROUPS } from "@/entities/experiment";

/** Как у каталога (features/paper-engine): стартовый бюджет, включён, без demo-зеркала. */
export const PRIVATE_DEFAULTS = {
  initialBudget: 10_000,
  enabled: true,
  demoMirror: false,
} as const;

/**
 * P + буква группы + номер: PS01 — spot, PF01 — usdm (USDⓈ-M), PC01 — coinm (COIN-M, spec 0023).
 * Не пересекается с id каталога (S.., F..).
 */
export const PRIVATE_ID_PATTERN = /^P([SFC])\d{2,}$/;
const PREFIX_MARKET: Record<string, ExperimentMarket> = {
  S: "spot",
  F: "usdm",
  C: "coinm",
};

/**
 * Эксперимент в private/experiments.json: формат каталога, необязательные поля — с дефолтами каталога.
 * Лишние поля верхнего уровня — ошибка: опечатка в имени поля не должна молча теряться.
 */
export const privateExperimentSchema = z.strictObject({
  ...experimentSchema.shape,
  // Файл, написанный до spec 0023, называет USDⓈ-M старым именем futures — читаем его как usdm.
  market: legacyMarketSchema,
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
      for (const issue of parsed.error.issues) {
        // Лишние поля строгой схемы — по ошибке на каждое, с путём до самого поля (config.marketFiltr).
        const paths =
          issue.code === "unrecognized_keys"
            ? issue.keys.map((key) => [...issue.path, key])
            : [issue.path];
        for (const path of paths)
          errors.push(`${who}: поле ${fieldPath(path)} — ${issue.message}`);
      }
      return;
    }
    const e = parsed.data;
    const prefix = PRIVATE_ID_PATTERN.exec(e.id)?.[1];
    if (!prefix) {
      errors.push(
        `${who}: поле id — нужен вид PS01 (spot), PF01 (usdm) или PC01 (coinm): «P», буква группы и номер`,
      );
      return;
    }
    if (PREFIX_MARKET[prefix] !== e.market) {
      errors.push(
        `${who}: поле market — префикс P${prefix} означает ${PREFIX_MARKET[prefix]}, а указано ${e.market}`,
      );
      return;
    }
    // Группа без демо-зеркала: включить его файлом нельзя, как и тумблером (с spec 0056 зеркало есть у всех групп).
    const blocked = ASSET_GROUPS[e.market].demoMirrorBlocked;
    if (e.demoMirror && blocked) {
      errors.push(`${who}: поле demoMirror — ${blocked}`);
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

/** Связь эксперимента с контрольным: из файла, каталога или строки БД. */
export interface ParentLink {
  id: string;
  parentId?: string | null;
}

/**
 * Проверка вариантов (spec 0046): родитель есть в файле, каталоге или БД и сам не вариант; у варианта нет своих
 * вариантов (один уровень); variantNote — только у варианта. known — каталог и строки БД; файл главнее строки БД с
 * тем же id. Ошибки — по одной на эксперимент, в формате parsePrivateExperiments.
 */
export function checkVariantParents(
  experiments: readonly Experiment[],
  known: readonly ParentLink[],
): string[] {
  const links = new Map<string, string | null>();
  for (const k of known) links.set(k.id, k.parentId ?? null);
  for (const e of experiments) links.set(e.id, e.parentId ?? null);
  const errors: string[] = [];
  for (const e of experiments) {
    const parentId = e.parentId ?? null;
    if (parentId === null) {
      if (e.variantNote)
        errors.push(
          `${e.id}: поле variantNote — только у варианта: нужен parentId контрольного`,
        );
      continue;
    }
    if (parentId === e.id) {
      errors.push(`${e.id}: поле parentId — ссылается на себя`);
      continue;
    }
    if (!links.has(parentId)) {
      errors.push(
        `${e.id}: поле parentId — контрольного ${parentId} нет ни в файле, ни в каталоге, ни в БД`,
      );
      continue;
    }
    const grand = links.get(parentId);
    if (grand) {
      errors.push(
        `${e.id}: поле parentId — ${parentId} сам вариант (от ${grand}): вариант варианта не поддерживается`,
      );
      continue;
    }
    const own = [...links]
      .filter(([, parent]) => parent === e.id)
      .map(([id]) => id);
    if (own.length)
      errors.push(
        `${e.id}: поле parentId — у ${e.id} есть свои варианты (${own.join(", ")}): контрольный не может быть вариантом`,
      );
  }
  return errors;
}

/** Поля строки experiments, которые сид обновляет (остальное — настройки пользователя). */
export interface ExistingRow {
  id: string;
  market: string;
  name: string;
  hypothesis: string;
  config: unknown;
  parentId: string | null;
  variantNote: string | null;
}

export type PlanStatus = "new" | "update" | "unchanged";

export interface PlanLine {
  id: string;
  market: ExperimentMarket;
  name: string;
  status: PlanStatus;
}

/** Что сделает запись: новая строка, обновление описания/конфига/связи с контрольным или ничего. */
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
          isDeepStrictEqual(row.config, e.config) &&
          row.parentId === (e.parentId ?? null) &&
          row.variantNote === (e.variantNote ?? null)
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

/** Подсказка, когда нет private/experiments.json: приватный репозиторий не склонирован. */
export const CLONE_HINT = [
  "Нет приватного репозитория. В основном checkout проекта:",
  "  git clone git@github-personal:aleksabramov77/binance-dashboard-private.git private",
  "В worktree задачи после этого: pnpm wt link (создаст ссылку private на основной checkout).",
].join("\n");

export const DEFAULT_PRIVATE_FILE = "private/experiments.json";

export interface LabPrivateArgs {
  dryRun: boolean;
  prod: boolean;
  file: string;
}

/**
 * Аргументы `pnpm lab:private`: --dry-run, --prod, --file <path> или --file=<path>.
 * Значение после `--file=` берётся целиком (делим по первому «=»): путь может содержать «=».
 */
export function parseLabPrivateArgs(
  argv: readonly string[],
): { ok: true; args: LabPrivateArgs } | { ok: false; error: string } {
  const args: LabPrivateArgs = {
    dryRun: false,
    prod: false,
    file: DEFAULT_PRIVATE_FILE,
  };
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf("=");
    const key = eq === -1 ? argv[i] : argv[i].slice(0, eq);
    const inline = eq === -1 ? undefined : argv[i].slice(eq + 1);
    if ((key === "--dry-run" || key === "--prod") && inline !== undefined)
      return { ok: false, error: `${key}: флаг без значения` };
    if (key === "--dry-run") args.dryRun = true;
    else if (key === "--prod") args.prod = true;
    else if (key === "--file") {
      const value = inline ?? argv[++i];
      if (!value) return { ok: false, error: "--file: нужен путь к JSON" };
      args.file = value;
    } else
      return {
        ok: false,
        error: `неизвестный аргумент ${argv[i]} (есть --dry-run, --prod, --file <path>)`,
      };
  }
  return { ok: true, args };
}

/**
 * Что делать: записать в локальную базу, только показать план (--dry-run) или отказать (--prod). Прод — файл SQLite
 * на VM (spec 0059): с ноутбука в него не пишем, отказ — до подключения к базе.
 */
export function decideLabPrivateWrite(
  args: Pick<LabPrivateArgs, "dryRun" | "prod">,
): "write" | "dry-run" | "prod-unsupported" {
  if (args.prod) return "prod-unsupported";
  if (args.dryRun) return "dry-run";
  return "write";
}
