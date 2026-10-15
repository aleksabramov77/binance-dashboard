// `pnpm lab:apply [--disable <id>]… [--enable <id>]… [--mirror-on <id>]… [--mirror-off <id>]… [--dry-run] [--local] [--out <каталог>]`
// — применить решения разбора лаборатории (flow lab, этап apply) к БД из .env.local: тумблер эксперимента и
// демо-зеркало. То же, что тумблеры в /settings и /experiments. Только после явного подтверждения пользователя.
// Печатает, к какой БД подключён; без DATABASE_URL (локальная PGlite) отказывается, если нет --local.
// С --out дописывает apply.md в каталог прогона. Реальных ордеров нет: зеркало — Binance Demo.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  readExperimentFlags,
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
    const apply = (c: ApplyChange) =>
      c.field === "enabled"
        ? setExperimentEnabled(db, c.id, c.to)
        : setExperimentDemoMirror(db, c.id, c.to);
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
