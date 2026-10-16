// `pnpm lab:apply [--disable <id>]… [--reason <id>=<категория>]… [--note <id>=<текст>]… [--force-control]
// [--enable <id>]… [--mirror-on <id>]… [--mirror-off <id>]… [--dry-run] [--local] [--out <каталог>]`
// — применить решения разбора лаборатории (flow lab, этап apply) к БД из .env.local: тумблер эксперимента и
// демо-зеркало. То же, что тумблеры в /settings и /experiments. Только после явного подтверждения пользователя.
// Выключение — только с причиной (spec 0046): --reason для каждого --disable; уже выключенному --disable с причиной
// обновляет причину. Контрольный, у которого остаются включённые варианты, — только с --force-control.
// Печатает, к какой БД подключён; без DATABASE_URL (локальная PGlite) отказывается, если нет --local.
// С --out дописывает apply.md в каталог прогона. Реальных ордеров нет: зеркало — Binance Demo.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  readExperimentFlags,
  setDisableReason,
  setExperimentDemoMirror,
  setExperimentEnabled,
} from "@/entities/experiment";
import {
  getDatabaseConfig,
  getDemoTradingConfig,
} from "@/shared/config/env.server";
import { closeDb, getDb } from "@/shared/db/client.server";
import { describeDatabase, isLocalDatabase } from "./lib/dbTarget";
import {
  type ApplyChange,
  diffApply,
  planApply,
  renderApplyMarkdown,
} from "./lib/labApply";

async function main() {
  const { values } = parseArgs({
    options: {
      disable: { type: "string", multiple: true },
      enable: { type: "string", multiple: true },
      "mirror-on": { type: "string", multiple: true },
      "mirror-off": { type: "string", multiple: true },
      reason: { type: "string", multiple: true },
      note: { type: "string", multiple: true },
      "force-control": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      local: { type: "boolean", default: false },
      out: { type: "string" },
    },
  });
  const plan = planApply(values);
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const config = getDatabaseConfig();
  const database = describeDatabase(config);
  console.log(`[lab:apply] БД: ${database}`);
  if (isLocalDatabase(config) && !plan.local)
    throw new Error(
      "DATABASE_URL не задан — это локальная PGlite, а не прод: решения туда не дойдут. Если так и задумано, добавьте --local.",
    );
  // Как тумблер в /settings: зеркало без ключей Binance Demo включать бессмысленно.
  if (plan.mirrorOn.length && getDemoTradingConfig() === null)
    throw new Error(
      "ключи Binance Demo не настроены (.env.local, раздел Demo Trading) — демо-зеркало включать нельзя",
    );

  const db = getDb();
  const changes = diffApply(plan, await readExperimentFlags(db));
  if (!plan.dryRun) {
    const apply = (c: ApplyChange) => {
      switch (c.field) {
        case "enabled":
          if (c.to) return setExperimentEnabled(db, c.id, { enabled: true });
          // planApply требует причину у каждого --disable; без неё не пишем.
          if (!c.reason) throw new Error(`${c.id}: выключение без причины`);
          return setExperimentEnabled(db, c.id, {
            enabled: false,
            ...c.reason,
          });
        case "reason":
          return setDisableReason(db, c.id, c.to);
        case "demoMirror":
          return setExperimentDemoMirror(db, c.id, c.to);
      }
    };
    for (const c of changes) await apply(c);
  }
  const md = renderApplyMarkdown(
    new Date().toISOString(),
    database,
    changes,
    plan.dryRun,
  );
  console.log(md);
  if (plan.out) {
    mkdirSync(plan.out, { recursive: true });
    appendFileSync(path.join(plan.out, "apply.md"), `${md}\n`);
  }
  await closeDb();
}

main().catch((error) => {
  console.error("[lab:apply]", error instanceof Error ? error.message : error);
  process.exit(1);
});
