// `pnpm lab:report [--experiment <id>]… [--since 7d|24h|<ISO>] [--out <каталог>]` — отчёт лаборатории по
// текущей эпохе из БД (.env.local: DATABASE_URL или локальный PGlite) для разбора экспериментов (flow lab,
// скилл trading-lab). Только чтение: пишет report.md и report.json в --out (по умолчанию — печать md).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readLabDataset } from "@/entities/experiment";
import { closeDb, getDb } from "@/shared/db/client.server";
import { buildLabReport, parseSince, renderLabReport } from "./lib/labReport";

async function main() {
  const { values } = parseArgs({
    options: {
      experiment: { type: "string", multiple: true },
      since: { type: "string" },
      out: { type: "string" },
    },
  });
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const now = Date.now();
  const data = await readLabDataset(getDb());
  const report = buildLabReport(data, {
    now,
    experimentIds: values.experiment?.map((id) => id.toUpperCase()),
    since: values.since ? parseSince(values.since, now) : null,
  });
  const md = renderLabReport(report);
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(path.join(values.out, "report.md"), md);
    writeFileSync(
      path.join(values.out, "report.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      `[lab:report] ${report.experiments.length} экспериментов → ${path.join(values.out, "report.md")}`,
    );
  } else {
    console.log(md);
  }
  await closeDb();
}

main().catch((error) => {
  console.error("[lab:report]", error);
  process.exit(1);
});
