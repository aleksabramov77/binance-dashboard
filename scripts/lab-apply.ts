// `pnpm lab:apply [--disable <id>]… [--enable <id>]… [--mirror-on <id>]… [--mirror-off <id>]… [--mirror-auto <id>]…
// [--dry-run] [--local] [--out <каталог>]` — применить решения разбора лаборатории (flow lab, этап apply) к БД из
// .env.local: тумблер эксперимента и положение демо-зеркала (--mirror-on / --mirror-off — ручные «Вкл» / «Выкл»,
// --mirror-auto — «Авто»: автомат сразу решает по правилу spec 0043, запись mirror.auto — в журнал /logs, Telegram —
// только с production-сервера). То же, что тумблеры в /settings и /experiments. Только после явного подтверждения.
// Печатает, к какой БД подключён; без DATABASE_URL (локальная PGlite) отказывается, если нет --local.
// С --out дописывает apply.md в каталог прогона. Реальных ордеров нет: зеркало — Binance Demo.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { writeLogs } from "@/app/server/logs";
import { runMirrorAuto } from "@/app/server/mirrorAuto";
import {
  readExperimentFlags,
  setExperimentEnabled,
  setExperimentMirrorMode,
} from "@/entities/experiment";
import {
  getDatabaseConfig,
  getDemoTradingConfig,
} from "@/shared/config/env.server";
import { closeDb, getDb } from "@/shared/db/client.server";
import { flushLogs, setLogSink } from "@/shared/lib/logger.server";
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
      "mirror-auto": { type: "string", multiple: true },
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
  // Решения авто-зеркала — в журнал БД (/logs), как с сервера.
  setLogSink(writeLogs);
  const changes = diffApply(plan, await readExperimentFlags(db));
  const notes: string[] = [];
  if (!plan.dryRun) {
    const apply = (c: ApplyChange) =>
      c.field === "enabled"
        ? setExperimentEnabled(db, c.id, c.to)
        : setExperimentMirrorMode(db, c.id, c.to);
    for (const c of changes)
      if (!(await apply(c)))
        throw new Error(
          `${c.id}: изменение не записано (эксперимента нет или группа не умеет демо-зеркало) — остальные изменения до него применены`,
        );
    // «Авто» сразу решает по правилу (AC7) — после всех тумблеров: выключенный эксперимент снимается с зеркала.
    const toAuto = changes
      .filter((c) => c.field === "demoMirrorMode" && c.to === "auto")
      .map((c) => c.id);
    if (toAuto.length) {
      const auto = await runMirrorAuto({ ids: toAuto });
      notes.push(...auto.changes.map((c) => c.message));
      for (const id of toAuto)
        if (!auto.changes.some((c) => c.id === id))
          notes.push(`${id}: зеркало без изменений`);
      if (auto.reason) notes.push(auto.reason);
    }
  }
  const md = renderApplyMarkdown(
    new Date().toISOString(),
    database,
    changes,
    plan.dryRun,
    notes,
  );
  console.log(md);
  if (plan.out) {
    mkdirSync(plan.out, { recursive: true });
    appendFileSync(path.join(plan.out, "apply.md"), `${md}\n`);
  }
  await flushLogs();
  await closeDb();
}

main().catch((error) => {
  console.error("[lab:apply]", error instanceof Error ? error.message : error);
  process.exit(1);
});
