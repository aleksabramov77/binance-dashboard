// `pnpm lab:private [--dry-run] [--file <path>]` — записать приватные эксперименты лаборатории
// (private/experiments.json, приватный репозиторий binance-dashboard-private) в таблицу experiments (spec 0015).
// БД — как у `pnpm db:migrate`: DATABASE_URL из .env.local (прод — Supabase), без неё — локальная PGlite.
// Upsert по id через seedExperiments: name, hypothesis, config обновляются; enabled, demoMirror, initialBudget
// пишутся только при вставке, сделки не трогаются. Содержимое экспериментов в журнал приложения не пишем.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { inArray } from "drizzle-orm";
import { experimentsTable, seedExperiments } from "@/entities/experiment";
import { EXPERIMENT_CATALOG } from "@/features/paper-engine";
import { getDatabaseConfig } from "@/shared/config/env.server";
import { closeDb, getDb, migrateDb } from "@/shared/db/client.server";
import {
  CLONE_HINT,
  describeDbTarget,
  formatPlanLine,
  parsePrivateExperiments,
  planPrivateSeed,
} from "./lib/labPrivate";

const DEFAULT_FILE = path.join("private", "experiments.json");

function fail(message: string): never {
  console.error(`[lab:private] ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { dryRun: boolean; file: string } {
  let dryRun = false;
  let file = DEFAULT_FILE;
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split("=", 2);
    if (key === "--dry-run") dryRun = true;
    else if (key === "--file") {
      const value = inline ?? argv[++i];
      if (!value) fail("--file: нужен путь к JSON");
      file = value;
    } else
      fail(`неизвестный аргумент ${argv[i]} (есть --dry-run, --file <path>)`);
  }
  return { dryRun, file };
}

async function main() {
  const { dryRun, file } = parseArgs(process.argv.slice(2));
  // Уже заданные переменные (в т.ч. пустой DATABASE_URL — принудительно PGlite) loadEnvFile не перезаписывает.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  if (!existsSync(file))
    fail(
      file === DEFAULT_FILE
        ? `нет ${file}.\n${CLONE_HINT}`
        : `нет файла ${file}`,
    );
  // Все проверки — до подключения к БД: при ошибке в БД ничего не пишется.
  const parsed = parsePrivateExperiments(
    readFileSync(file, "utf8"),
    new Set(EXPERIMENT_CATALOG.map((e) => e.id)),
  );
  if (!parsed.ok)
    fail(
      `${file}: ошибок ${parsed.errors.length}, в БД ничего не записано:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  const { experiments } = parsed;

  const target = getDatabaseConfig();
  console.log(`БД: ${describeDbTarget(target)}`);
  if (!experiments.length) {
    console.log(`${file}: экспериментов нет — записывать нечего`);
    return;
  }

  const db = getDb();
  // Локальную PGlite готовим сами (может быть пустой); прод мигрирует деплой — схему там не трогаем.
  if (target.kind === "pglite") await migrateDb();
  const existing = await db
    .select({
      id: experimentsTable.id,
      market: experimentsTable.market,
      name: experimentsTable.name,
      hypothesis: experimentsTable.hypothesis,
      config: experimentsTable.config,
    })
    .from(experimentsTable)
    .where(
      inArray(
        experimentsTable.id,
        experiments.map((e) => e.id),
      ),
    );
  const plan = planPrivateSeed(experiments, existing);
  for (const line of plan) console.log(`  ${formatPlanLine(line)}`);

  if (dryRun) {
    console.log("--dry-run: в БД ничего не записано");
    return;
  }
  const changed = new Set(
    plan.filter((l) => l.status !== "unchanged").map((l) => l.id),
  );
  await db.transaction((tx) =>
    seedExperiments(
      tx,
      experiments.filter((e) => changed.has(e.id)),
    ),
  );
  console.log(
    `Записано: ${changed.size} из ${plan.length} (новые и обновлённые); тумблеры, бюджеты и сделки не тронуты`,
  );
}

main()
  .catch((error) => {
    console.error("[lab:private]", error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
