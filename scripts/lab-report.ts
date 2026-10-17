// `pnpm lab:report [--prod] [--run <id>] [--experiment <id>]… [--since 7d|24h|<ISO>] [--out <каталог>] [--no-market]
// [--after-exit] [--no-prices]` — отчёт лаборатории по эпохе из БД для разбора
// экспериментов (flow lab, агент quant, скилл trading-lab). Только чтение; печатает, к какой БД подключён.
// `--prod` — сначала `pnpm db:pull` (свежий снимок прод-базы с VM в data/prod.db), отчёт — по нему (spec 0059);
// без флага — локальная база (DATABASE_PATH, по умолчанию data/app.db).
// Эпоха — текущая, `--run <id>` — прошлая (период — до начала следующей эпохи).
// Считает всегда по всем экспериментам (семейства, архетипы, контроль нужны целиком); --experiment — фокус:
// подробные разделы только по этим id. С --out пишет report.md, report.json, trades.csv (сделки периода) и
// skipped.csv (отсечённые сигналы); без — печатает md. Контекст рынка (BTC 4h/1d с публичного API Binance) — если
// нет --no-market и есть сеть. `--after-exit` догружает свечи ТФ экспериментов (публичный API, по символу на
// запрос): «что было через 4/12/24 свечи после выхода» и грубый исход отсечённых сигналов; по умолчанию выключен.
// Открытые позиции текущей эпохи оцениваются по последней цене (`ticker/price` публичного API, баг 0041): столбцы
// «Откр.» и «Нереализ. R / $», в report.json — `unrealized`; `--no-prices` — без этого запроса.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import type {
  ExperimentMarket,
  PaperTrade,
  Timeframe,
} from "@binance-dashboard/trading-core";
import { filterTrades, readLabDataset } from "@/entities/experiment";
import { priceKey } from "@/features/paper-engine";
import { fetchKlines } from "@/shared/api/binance/market";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import { getDatabaseConfig } from "@/shared/config/env.server";
import { closeDb, getDb } from "@/shared/db/client.server";
import { describeDatabase, PROD_SNAPSHOT_PATH } from "./lib/dbTarget";
import { type KlineSet, klineRequests, loadKlines } from "./lib/labKlines";
import { loadMarketContext, type MarketContext } from "./lib/labMarket";
import {
  buildLabReport,
  type OpenPricing,
  parseSince,
  renderLabReport,
  renderSkippedCsv,
  renderTradesCsv,
} from "./lib/labReport";

async function marketContext(
  enabled: boolean,
  periodStart: number,
  end: number,
): Promise<MarketContext | null> {
  if (!enabled) return null;
  try {
    return await loadMarketContext(periodStart, end);
  } catch (error) {
    console.warn(
      `[lab:report] контекст рынка не загружен: ${error instanceof Error ? error.message : error}`,
    );
    return null;
  }
}

/** Последние цены рынков открытых позиций (публичный `ticker/price`); рынок не ответил — его позиции без оценки. */
async function openPricing(
  open: PaperTrade[],
  now: number,
): Promise<OpenPricing | null> {
  const markets = new Set<ExperimentMarket>(open.map((t) => t.market));
  if (!markets.size) return null;
  const prices: Record<string, number> = {};
  await Promise.all(
    [...markets].map(async (market) => {
      try {
        for (const [symbol, price] of await fetchTickerPrices(market))
          prices[priceKey(market, symbol)] = price;
      } catch (error) {
        console.warn(
          `[lab:report] цены ${market} не получены — открытые позиции не оценены: ${error instanceof Error ? error.message : error}`,
        );
      }
    }),
  );
  return {
    prices,
    source: "ticker/price публичного API Binance",
    at: new Date(now).toISOString(),
  };
}

/** `--run`: целое число ≥ 1. */
function parseRun(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1)
    throw new Error(`--run: нужен id эпохи (целое число), а не «${value}»`);
  return id;
}

async function main() {
  const { values } = parseArgs({
    options: {
      run: { type: "string" },
      experiment: { type: "string", multiple: true },
      since: { type: "string" },
      out: { type: "string" },
      "no-market": { type: "boolean", default: false },
      "after-exit": { type: "boolean", default: false },
      "no-prices": { type: "boolean", default: false },
      prod: { type: "boolean", default: false },
    },
  });
  const runId = parseRun(values.run);
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  if (values.prod) {
    // Свежий снимок прода — тем же скриптом, что `pnpm db:pull`; не скачался — отчёта по старому снимку не строим.
    const pull = spawnSync(
      "pnpm",
      ["-s", "db:pull", "--out", PROD_SNAPSHOT_PATH],
      {
        stdio: "inherit",
      },
    );
    if (pull.status !== 0)
      throw new Error(
        "снимок прод-базы не скачан (pnpm db:pull) — отчёт не построен",
      );
    process.env.DATABASE_PATH = PROD_SNAPSHOT_PATH;
  }
  const database = describeDatabase(getDatabaseConfig());
  console.log(`[lab:report] БД: ${database}`);
  const now = Date.now();
  const data = await readLabDataset(
    getDb(),
    ({ id, problem }) =>
      console.warn(`[lab:report] эксперимент ${id} пропущен: ${problem}`),
    runId,
  );
  const since = values.since ? parseSince(values.since, now) : null;
  const end = data.run.endedAt ? Date.parse(data.run.endedAt) : now;
  const periodStart = Math.max(Date.parse(data.run.startedAt), since ?? 0);
  const market = await marketContext(!values["no-market"], periodStart, end);
  const trades = filterTrades(data.trades, { since });
  const skipped = data.skipped.filter(
    (s) => since === null || Date.parse(s.at) >= since,
  );

  let klines: KlineSet | null = null;
  if (values["after-exit"]) {
    const tf = new Map<string, Timeframe>(
      data.experiments.map((e) => [e.id, e.config.timeframe]),
    );
    const requests = klineRequests(trades, skipped, (id) => tf.get(id));
    console.log(
      `[lab:report] --after-exit: свечи ТФ по ${requests.length} (рынок, символ, ТФ)…`,
    );
    klines = await loadKlines(requests, fetchKlines, now, (r, error) =>
      console.warn(
        `[lab:report] свечи ${r.market} ${r.symbol} ${r.tf} не загружены: ${error instanceof Error ? error.message : error}`,
      ),
    );
  }

  // Прошлая эпоха закрыта сбросом — открытых в ней нет, а цены «сейчас» к ней не относятся.
  const pricing =
    values["no-prices"] || data.run.endedAt
      ? null
      : await openPricing(
          data.trades.filter((t) => t.closedAt === null),
          now,
        );

  const report = buildLabReport(data, {
    now,
    focus: values.experiment?.map((id) => id.toUpperCase()),
    since,
    market,
    database,
    klines,
    openPricing: pricing,
  });
  const md = renderLabReport(report);
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(path.join(values.out, "report.md"), md);
    writeFileSync(
      path.join(values.out, "report.json"),
      JSON.stringify(report, null, 2),
    );
    writeFileSync(path.join(values.out, "trades.csv"), renderTradesCsv(trades));
    writeFileSync(
      path.join(values.out, "skipped.csv"),
      renderSkippedCsv(skipped),
    );
    console.log(
      `[lab:report] ${report.experiments.length} экспериментов → ${path.join(values.out, "report.md")} (+ report.json, trades.csv, skipped.csv)`,
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
