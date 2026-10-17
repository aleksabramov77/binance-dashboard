// `pnpm lab:apply [--disable <id>]… [--enable <id>]… [--mirror-on <id>]… [--mirror-off <id>]… [--mirror-auto <id>]…
// [--dry-run] [--local] [--out <каталог>]` — применить решения разбора лаборатории (flow lab, этап apply) к БД из
// .env.local: тумблер эксперимента и положение демо-зеркала (--mirror-on / --mirror-off — ручные «Вкл» / «Выкл»,
// --mirror-auto — «Авто»: автомат сразу решает по правилу spec 0043, запись mirror.auto — в журнал /logs, уведомление
// отправляет только production-сервер). То же, что тумблеры в /settings и /experiments. Только после явного
// подтверждения.
// Выключение — только с причиной (spec 0046): `--reason <id>=<категория>` для каждого --disable (+ `--note <id>=<текст>`);
// уже выключенному --disable с причиной обновляет причину. Контрольный, у которого остаются включённые варианты, —
// только с `--force-control`.
// Печатает, к какой БД подключён. Прод — SQLite на VM (spec 0059): туда скрипт не пишет — без --local отказывает с
// подсказкой (тумблеры — на /experiments и /settings); с --local пишет в локальную базу (DATABASE_PATH, data/app.db).
// С --out дописывает apply.md в каталог прогона. Реальных ордеров нет: зеркало — Binance Demo.
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { writeLogs } from "@/app/server/logs";
import { runMirrorAuto } from "@/app/server/mirrorAuto";
import { createNotifyChannels } from "@/app/server/notify";
import {
  readExperimentFlags,
  setDisableReason,
  setExperimentEnabled,
  setExperimentMirrorMode,
} from "@/entities/experiment";
import {
  getDatabaseConfig,
  getDemoTradingConfig,
} from "@/shared/config/env.server";
import { closeDb, getDb, migrateDb } from "@/shared/db/client.server";
import {
  flushLogs,
  setLogSink,
  setNotifyChannels,
} from "@/shared/lib/logger.server";
import { describeDatabase, PROD_WRITE_HINT } from "./lib/dbTarget";
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
  if (!plan.local)
    throw new Error(
      `${PROD_WRITE_HINT}\n  Записать в локальную базу (${config.path}) — добавьте --local.`,
    );
  // Как тумблер в /settings: зеркало без ключей Binance Demo включать бессмысленно.
  if (plan.mirrorOn.length && getDemoTradingConfig() === null)
    throw new Error(
      "ключи Binance Demo не настроены (.env.local, раздел Demo Trading) — демо-зеркало включать нельзя",
    );

  const db = getDb();
  // Локальная база может быть новой (пустой файл) — миграции идемпотентны.
  await migrateDb();
  // Решения авто-зеркала — в журнал БД (/logs), как с сервера; канал уведомлений тот же — вне production он не
  // отправляет, а пишет в запись, куда ушло бы (spec 0067).
  setLogSink(writeLogs);
  setNotifyChannels(createNotifyChannels());
  const changes = diffApply(plan, await readExperimentFlags(db));
  const notes: string[] = [];
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
        case "demoMirrorMode":
          return setExperimentMirrorMode(db, c.id, c.to);
      }
    };
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
