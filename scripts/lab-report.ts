// `pnpm lab:report [--experiment <id>]… [--since 7d|24h|<ISO>] [--out <каталог>] [--no-market]` — отчёт
// лаборатории по текущей эпохе из БД (.env.local: DATABASE_URL или локальный PGlite) для разбора экспериментов
// (flow lab, агент quant, скилл trading-lab). Только чтение; печатает, к какой БД подключён.
// Считает всегда по всем экспериментам (семейства, архетипы, контроль нужны целиком); --experiment — фокус:
// подробные разделы только по этим id. С --out пишет report.md, report.json и trades.csv (сделки периода);
// без — печатает md. Контекст рынка (BTC 4h/1d с публичного API Binance) — если нет --no-market и есть сеть.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { filterTrades, readLabDataset } from "@/entities/experiment";
import { getDatabaseConfig } from "@/shared/config/env.server";
import { closeDb, getDb } from "@/shared/db/client.server";
import { describeDatabase } from "./lib/dbTarget";
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
  const database = describeDatabase(getDatabaseConfig());
  console.log(`[lab:report] БД: ${database}`);
  const now = Date.now();
  const data = await readLabDataset(getDb(), ({ id, problem }) =>
    console.warn(`[lab:report] эксперимент ${id} пропущен: ${problem}`),
  );
  const since = values.since ? parseSince(values.since, now) : null;
  const periodStart = Math.max(Date.parse(data.run.startedAt), since ?? 0);
  const market = await marketContext(!values["no-market"], periodStart, now);
  const report = buildLabReport(data, {
    now,
    focus: values.experiment?.map((id) => id.toUpperCase()),
    since,
    market,
    database,
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
      renderTradesCsv(filterTrades(data.trades, { since })),
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
  console.error("[lab:report]", error instanceof Error ? error.message : error);
  process.exit(1);
});
