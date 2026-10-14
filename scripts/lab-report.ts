// `pnpm lab:report [--experiment <id>]… [--since 7d|24h|<ISO>] [--out <каталог>] [--no-market]` — отчёт
// лаборатории по текущей эпохе из БД (.env.local: DATABASE_URL или локальный PGlite) для разбора экспериментов
// (flow lab, агент quant, скилл trading-lab). Только чтение. С --out пишет report.md, report.json и trades.csv;
// без — печатает md. Контекст рынка (BTC 4h/1d с публичного API Binance) — если нет --no-market и есть сеть.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readLabDataset } from "@/entities/experiment";
import { closeDb, getDb } from "@/shared/db/client.server";
import { loadMarketContext, type MarketContext } from "./lib/labMarket";
import {
  buildLabReport,
  parseSince,
  renderLabReport,
  renderTradesCsv,
} from "./lib/labReport";

async function marketContext(
  enabled: boolean,
  periodStart: number,
  now: number,
): Promise<MarketContext | null> {
  if (!enabled) return null;
  try {
    return await loadMarketContext(periodStart, now);
  } catch (error) {
    console.warn(
      `[lab:report] контекст рынка не загружен: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      experiment: { type: "string", multiple: true },
      since: { type: "string" },
      out: { type: "string" },
      "no-market": { type: "boolean", default: false },
    },
  });
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const now = Date.now();
  const data = await readLabDataset(getDb());
  const since = values.since ? parseSince(values.since, now) : null;
  const periodStart = Math.max(Date.parse(data.run.startedAt), since ?? 0);
  const market = await marketContext(!values["no-market"], periodStart, now);
  const report = buildLabReport(data, {
    now,
    experimentIds: values.experiment?.map((id) => id.toUpperCase()),
    since,
    market,
  });
  const md = renderLabReport(report);
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(path.join(values.out, "report.md"), md);
    writeFileSync(
      path.join(values.out, "report.json"),
      JSON.stringify(report, null, 2),
    );
    writeFileSync(
      path.join(values.out, "trades.csv"),
      renderTradesCsv(
        data.trades.filter((t) =>
          report.experiments.some((e) => e.id === t.experimentId),
        ),
      ),
    );
    console.log(
      `[lab:report] ${report.experiments.length} экспериментов → ${path.join(values.out, "report.md")} (+ report.json, trades.csv)`,
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
