// `pnpm lab:private [--dry-run] [--prod] [--file <path>]` — записать приватные эксперименты лаборатории
// (private/experiments.json, приватный репозиторий binance-dashboard-private) в таблицу experiments (spec 0015).
// База — локальный файл SQLite (DATABASE_PATH, по умолчанию data/app.db; spec 0059) — для сервера worktree тот же
// файл, что у `pnpm wt serve`. Прод — SQLite на VM: `--prod` отказывает с подсказкой (запись в прод — задача в очереди PRD).
// Upsert по id через seedExperiments: name, hypothesis, config, parentId, variantNote обновляются; enabled,
// demoMirror, initialBudget пишутся только при вставке, сделки не трогаются. Вариант (spec 0046): родитель должен
// быть в файле, каталоге или БД и сам не быть вариантом — иначе ошибка до записи. Содержимое экспериментов в журнал приложения не пишем.
import { existsSync, readFileSync } from "node:fs";
import { experimentsTable, seedExperimentsSync } from "@/entities/experiment";
import { EXPERIMENT_CATALOG } from "@/features/paper-engine";
import { getDatabaseConfig } from "@/shared/config/env.server";
import { closeDb, getDb, migrateDb } from "@/shared/db/client.server";
import { describeDatabase, PROD_WRITE_HINT } from "./lib/dbTarget";
import {
  CLONE_HINT,
  checkVariantParents,
  DEFAULT_PRIVATE_FILE,
  decideLabPrivateWrite,
  formatPlanLine,
  parseLabPrivateArgs,
  parsePrivateExperiments,
  planPrivateSeed,
} from "./lib/labPrivate";

function fail(message: string): never {
  console.error(`[lab:private] ${message}`);
  process.exit(1);
}

async function main() {
  const parsedArgs = parseLabPrivateArgs(process.argv.slice(2));
  if (!parsedArgs.ok) fail(parsedArgs.error);
  const { dryRun, prod, file } = parsedArgs.args;
  const decision = decideLabPrivateWrite({ dryRun, prod });
  if (decision === "prod-unsupported")
    fail(
      `${PROD_WRITE_HINT}\n  Новые эксперименты из private/experiments.json — в локальную базу: pnpm lab:private (без --prod).`,
    );
  // Уже заданные переменные (в т.ч. DATABASE_PATH) loadEnvFile не перезаписывает.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");

  if (!existsSync(file))
    fail(
      file === DEFAULT_PRIVATE_FILE
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

  console.log(`БД: ${describeDatabase(getDatabaseConfig())}`);
  if (!experiments.length) {
    console.log(`${file}: экспериментов нет — записывать нечего`);
    return;
  }
  const db = getDb();
  // Локальная база может быть пустой или новее кода — миграции идемпотентны.
  await migrateDb();
  const rows = await db
    .select({
      id: experimentsTable.id,
      market: experimentsTable.market,
      name: experimentsTable.name,
      hypothesis: experimentsTable.hypothesis,
      config: experimentsTable.config,
      parentId: experimentsTable.parentId,
      variantNote: experimentsTable.variantNote,
    })
    .from(experimentsTable);
  // Связи вариантов — против каталога и всей таблицы: контрольный может быть и не из файла.
  const variantErrors = checkVariantParents(experiments, [
    ...EXPERIMENT_CATALOG,
    ...rows,
  ]);
  if (variantErrors.length)
    fail(
      `${file}: ошибок ${variantErrors.length}, в БД ничего не записано:\n${variantErrors.map((e) => `  - ${e}`).join("\n")}`,
    );
  const ids = new Set(experiments.map((e) => e.id));
  const plan = planPrivateSeed(
    experiments,
    rows.filter((r) => ids.has(r.id)),
  );
  for (const line of plan) console.log(`  ${formatPlanLine(line)}`);

  if (decision === "dry-run") {
    console.log("--dry-run: в БД ничего не записано");
    return;
  }
  const changed = new Set(
    plan.filter((l) => l.status !== "unchanged").map((l) => l.id),
  );
  // Одна синхронная транзакция SQLite: все эксперименты или ни одного.
  db.transaction((tx) =>
    seedExperimentsSync(
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
