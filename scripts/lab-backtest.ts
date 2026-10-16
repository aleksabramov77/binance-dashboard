// `pnpm lab:backtest --ids <id[,id…]> [--file private/experiments.json]… [--days 120] [--to <ISO>] [--split 0.66]
// [--exit-tf auto|1m|5m|15m] [--out <каталог>] [--cache <каталог>] [--no-download] [--no-control]` — бэктест экспериментов
// лаборатории по истории свечей Binance (spec 0032). Это повтор настоящего тика движка (runTick) с хранилищем в памяти
// и историческими данными: своей торговой логики нет, заглядывания вперёд нет. Отчёт — как у `pnpm lab:report`:
// report.md, report.json, trades.csv, skipped.csv в --out (по умолчанию private/lab/backtests/<дата>-<хэш>/).
// Свечи и funding — публичный API Binance без ключей через дисковый кэш вне git (~/.cache/binance-dashboard):
// повторный прогон того же периода ничего не скачивает. Ордеров нет, БД не используется.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import type { Experiment } from "@binance-dashboard/trading-core";
import { EXPERIMENT_CATALOG } from "@/features/paper-engine";
import {
  backtestKlines,
  backtestMarketContext,
  backtestOpenPricing,
  backtestPeriod,
  buildBacktestReport,
  chooseExitInterval,
  DEFAULT_OUT_ROOT,
  exitIntervalError,
  limitationsOf,
  mergeFileExperiments,
  parseBacktestArgs,
  runBacktest,
  runHash,
  selectExperiments,
  splitPoint,
  stepOf,
} from "./lib/labBacktest";
import { createDiskHistory, RateLimitStopError } from "./lib/labHistory";
import { parsePrivateExperiments } from "./lib/labPrivate";
import { renderSkippedCsv, renderTradesCsv } from "./lib/labReport";

const DAY = 86_400_000;
const log = (message: string) => console.log(`[lab:backtest] ${message}`);

function fail(message: string): never {
  console.error(`[lab:backtest] ${message}`);
  process.exit(1);
}

function readFileExperiments(file: string): Experiment[] {
  if (!existsSync(file)) fail(`нет файла ${file}`);
  const parsed = parsePrivateExperiments(
    readFileSync(file, "utf8"),
    new Set(EXPERIMENT_CATALOG.map((e) => e.id)),
  );
  if (!parsed.ok)
    fail(
      `${file}: ошибок ${parsed.errors.length}:\n${parsed.errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  return parsed.experiments;
}

/** Эксперименты из всех --file: один id в двух файлах — ошибка (непонятно, какой конфиг гонять). */
function readAllFiles(files: string[]): Experiment[] {
  const merged = mergeFileExperiments(
    files.map((file) => ({ file, experiments: readFileExperiments(file) })),
  );
  if (!merged.ok) fail(merged.error);
  return merged.experiments;
}

async function main() {
  const { values } = parseArgs({
    options: {
      ids: { type: "string", multiple: true },
      file: { type: "string", multiple: true },
      days: { type: "string" },
      to: { type: "string" },
      split: { type: "string" },
      "exit-tf": { type: "string" },
      out: { type: "string" },
      cache: { type: "string" },
      "no-download": { type: "boolean", default: false },
      "no-control": { type: "boolean", default: false },
    },
  });
  const parsed = parseBacktestArgs(values);
  if (!parsed.ok) fail(parsed.error);
  const args = parsed.args;

  const selected = selectExperiments(
    args.ids,
    EXPERIMENT_CATALOG,
    readAllFiles(args.files),
    !args.noControl,
  );
  if (!selected.ok) fail(selected.error);
  const { experiments, controlsAdded } = selected;
  const own = experiments.filter((e) => !controlsAdded.includes(e.id));

  const startedAt = Date.now();
  const step = stepOf(experiments);
  const { start, end } = backtestPeriod(args.to ?? startedAt, args.days, step);
  const days = (end - start) / DAY;
  const exitInterval =
    args.exitInterval ?? chooseExitInterval(days, experiments);
  const wrongExit = exitIntervalError(exitInterval, step);
  if (wrongExit) fail(wrongExit);
  const splitAt =
    args.split === null ? null : splitPoint(start, end, args.split, step);

  const out =
    args.out ??
    path.join(
      DEFAULT_OUT_ROOT,
      `${new Date(startedAt).toISOString().slice(0, 10)}-${runHash([
        ...experiments.map((e) => e.id),
        String(start),
        String(end),
        exitInterval,
        String(args.split),
      ])}`,
    );
  if (!args.out && !existsSync("private"))
    fail(
      "нет private/ (клон приватного репозитория) — укажите каталог отчёта: --out /tmp/backtest-…",
    );
  const cache =
    args.cache ?? path.join(os.homedir(), ".cache", "binance-dashboard");

  log(
    `${experiments.map((e) => e.id).join(", ")}${controlsAdded.length ? ` (контроль добавлен: ${controlsAdded.join(", ")})` : ""}`,
  );
  log(
    `период ${new Date(start).toISOString()} — ${new Date(end).toISOString()} (${days.toFixed(1)} дн.), шаг ${step}, выходы по ${exitInterval}${args.exitInterval ? "" : " (авто)"}${splitAt ? `, split ${args.split} → ${new Date(splitAt).toISOString()}` : ""}`,
  );
  log(`кэш: ${cache}${args.noDownload ? " (только кэш, --no-download)" : ""}`);

  let lastRequestLog = 0;
  const history = createDiskHistory({
    root: cache,
    noDownload: args.noDownload,
    onNotice: (m) => log(m),
    onRequest: (stats, label) => {
      if (stats.requests - lastRequestLog >= 100) {
        lastRequestLog = stats.requests;
        log(
          `загрузка: ${stats.requests} запросов (вес ${stats.weight}), последний — ${label}`,
        );
      }
    },
  });

  let lastShare = -1;
  const run = await runBacktest({
    experiments,
    start,
    end,
    exitInterval,
    history,
    onTick: (done, total, now, trades) => {
      const share = Math.floor((done / total) * 20);
      if (share !== lastShare) {
        lastShare = share;
        log(
          `тики: ${done}/${total} (${Math.round((done / total) * 100)}%), ${new Date(now).toISOString().slice(0, 16)}, сделок ${trades}`,
        );
      }
    },
  });

  const klines = await backtestKlines(run, experiments, start, end);
  const market = {
    full: await backtestMarketContext(run.series, start, start, end),
    ...(splitAt
      ? {
          train: await backtestMarketContext(run.series, start, start, splitAt),
          test: await backtestMarketContext(run.series, start, splitAt, end),
        }
      : {}),
  };
  const symbols = Object.fromEntries(
    Object.entries(run.symbols).map(([m, s]) => [
      m,
      { count: s.count, snapshotAt: new Date(s.snapshotAt).toISOString() },
    ]),
  );
  const openAtEnd = run.trades.filter((t) => t.closedAt === null).length;
  const openPricing = await backtestOpenPricing(run, exitInterval, end);
  const { report, md } = buildBacktestReport({
    experiments,
    trades: run.trades,
    skipped: run.skipped,
    start,
    end,
    market,
    klines,
    openPricing,
    meta: {
      generatedAt: new Date().toISOString(),
      ids: own.map((e) => e.id),
      controlsAdded,
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end).toISOString(),
      days,
      step: run.step,
      ticks: run.ticks,
      exitInterval,
      exitAuto: args.exitInterval === null,
      split:
        splitAt && args.split
          ? { fraction: args.split, at: new Date(splitAt).toISOString() }
          : null,
      symbols,
      fundingMissing: run.fundingMissing,
      openAtEnd,
      errors: run.errors,
      download: { ...history.stats },
      cache,
      limitations: limitationsOf({
        experiments,
        exitInterval,
        step: run.step,
        symbols,
        fundingMissing: run.fundingMissing,
        openAtEnd,
      }),
    },
  });

  // Бан пришёл уже после тиков (свечи для отчёта, контекст рынка): данные неполные — отчёт не пишем.
  const stopped = history.stopped();
  if (stopped) throw stopped;

  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "report.md"), md);
  writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(out, "trades.csv"), renderTradesCsv(run.trades));
  writeFileSync(path.join(out, "skipped.csv"), renderSkippedCsv(run.skipped));
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
  log(
    `готово за ${seconds} с: ${run.ticks} тиков, сделок ${run.trades.length} (открыто на конец ${openAtEnd}), запросов к Binance ${history.stats.requests}, ошибок данных ${run.errors.reduce((s, e) => s + e.count, 0)}`,
  );
  for (const e of run.errors.slice(0, 5))
    log(`  ошибка × ${e.count}: ${e.message}`);
  log(
    `→ ${path.join(out, "report.md")} (+ report.json, trades.csv, skipped.csv)`,
  );
}

main().catch((error) => {
  console.error(
    "[lab:backtest]",
    error instanceof Error ? error.message : error,
  );
  if (error instanceof RateLimitStopError)
    console.error(
      "[lab:backtest] прогон прерван, отчёт не записан: Binance ограничил IP. Уже загруженное — в кэше, повтор позже догрузит только недостающее.",
    );
  process.exit(1);
});
