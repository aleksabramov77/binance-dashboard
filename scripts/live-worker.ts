// `pnpm live:worker` — воркер реального счёта (spec 0047, 0049). Отдельный процесс: только у него торговый ключ субсчёта
// (BINANCE_TRADE_API_KEY / SECRET). Раз в минуту проверяет ключ (права — при старте и каждые 10 мин), шлёт пульс
// в приложение (POST ${LIVE_APP_URL}/api/live/heartbeat, Bearer LIVE_WORKER_SECRET) и, если пульс принят, — прогон
// реального зеркала (spec 0049): входы включённых экспериментов, закрытия, сверка ног, «Закрыть всё». Хранилище — API
// приложения /api/live/mirror/*. Входящих соединений не принимает, DATABASE_URL и Telegram ему не нужны, журнал —
// stdout/stderr (на VM — journald), файлов не пишет. Ордера — только через клиент Live с белым списком.
//
//   pnpm live:worker                 — цикл раз в минуту (на VM — systemd-сервис binance-live)
//   pnpm live:worker --once          — один пульс и один прогон зеркала, выход (код 1 — пульс не принят)
//   pnpm live:worker --once --fixture ok|blocked|main-account
//                                    — готовый пульс без биржи: только без ключа и только на localhost (зеркала нет)
//   pnpm live:worker --venue demo    — «площадка демо»: тот же код и белый список, но Binance Demo и ключ
//                                    BINANCE_DEMO_* — только для локальной проверки (не production, только localhost)
//
// Сборка в один файл для VM: `pnpm live:build` → dist/live-worker.mjs (`node dist/live-worker.mjs --once`).
import { existsSync, readFileSync } from "node:fs";
import type { z } from "zod";
import {
  DEMO_VENUE_HEADER,
  LIVE,
  LIVE_FIXTURES,
  type LiveFixture,
  type LiveHeartbeat,
  liveHeartbeatReplySchema,
} from "@/entities/live-account";
import {
  closeDemoPosition,
  placeTrade,
  SPOT_ENTRY_SLIPPAGE,
  sizeEntry,
  sweepTriggeredLegs,
  type TradeVenueContext,
} from "@/features/execute-trade";
import { KEY_REJECTED_REASON } from "@/shared/api/binance";
import {
  enableOnewayMode,
  fetchDemoAlgoOrder,
  fetchDemoFills,
  fetchDemoFuturesAccountBusy,
  fetchDemoFuturesOrder,
  fetchDemoPositionMode,
  fetchDemoPrice,
  fetchDemoSpotOrderByClientId,
  fetchDemoSymbolRules,
  fetchDemoUsdtBalances,
} from "@/shared/api/binance/demo.server";
import {
  fetchLiveApiRestrictions,
  fetchLiveFuturesAccount,
  fetchLiveSpotAccount,
  LIVE_DEMO_HOSTS,
  type LiveClient,
  liveClient,
  liveVenue,
} from "@/shared/api/binance/live.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import {
  getDemoTradingConfig,
  getLiveAppUrl,
  getLiveTradeCredentials,
  getLiveWorkerSecret,
} from "@/shared/config/env.server";
import { describeNetworkError } from "@/shared/lib/fetchRetry";
import { disableLogFiles, log } from "@/shared/lib/logger.server";
import {
  type LiveExchange,
  mirrorApi,
  type OutboxItem,
  runLiveMirror,
} from "./lib/liveMirrorRun";
import {
  appUrlRefusal,
  DEMO_VENUE_FLAGS,
  demoVenueRefusal,
  emptyMemory,
  fixtureHeartbeat,
  fixtureRefusal,
  HEARTBEAT_EVERY_MS,
  hasAnyTradeKey,
  isLiveFixture,
  noKeyHeartbeat,
  pulseWithHandshake,
  runCheck,
  toWire,
  type WorkerDeps,
} from "./lib/liveWorker";

// Журнал воркера — только консоль: на VM его собирает journald, диск и БД воркер не трогает.
disableLogFiles();

/** Версия сборки: `pnpm live:build` подставляет её константой (esbuild define); под tsx — dev. */
const VERSION = process.env.LIVE_WORKER_VERSION || "dev";
/** Цены для equity Spot меняются медленно относительно пульса — один публичный запрос в 5 минут. */
const PRICES_TTL_MS = 5 * 60_000;
const SEND_TIMEOUT_MS = 15_000;

/**
 * Локально — .env.local из текущего каталога (только строки ИМЯ=значение, заданное окружением не
 * перезаписывается). На VM env задаёт systemd (/etc/binance-live/app.env), файла рядом нет.
 */
function loadEnvFile(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
}

function parseArgs(argv: string[]): {
  once: boolean;
  fixture: LiveFixture | null;
  demoVenue: boolean;
} {
  const once = argv.includes("--once");
  const v = argv.indexOf("--venue");
  const venue = v === -1 ? "live" : (argv[v + 1] ?? "");
  if (venue !== "live" && venue !== "demo")
    throw new Error(`--venue: ожидается live | demo, получено «${venue}»`);
  const i = argv.indexOf("--fixture");
  if (i === -1) return { once, fixture: null, demoVenue: venue === "demo" };
  const value = argv[i + 1] ?? "";
  if (!isLiveFixture(value))
    throw new Error(
      `--fixture: ожидается ${LIVE_FIXTURES.join(" | ")}, получено «${value}»`,
    );
  if (venue === "demo")
    throw new Error("--fixture и --venue demo вместе нельзя");
  return { once, fixture: value, demoVenue: false };
}

function fail(message: string): never {
  log.error("live.worker", message);
  process.exit(1);
}

loadEnvFile(".env.local");

let args: ReturnType<typeof parseArgs>;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const appUrl = getLiveAppUrl();
if (!appUrl)
  fail(
    "LIVE_APP_URL не задан: куда слать пульс (например, http://localhost:5001)",
  );
const urlRefusal = appUrlRefusal(appUrl);
if (urlRefusal) fail(urlRefusal);
const secret = getLiveWorkerSecret();
const creds = getLiveTradeCredentials();
if (args.fixture) {
  const refusal = fixtureRefusal({
    hasTradeKey: hasAnyTradeKey(process.env),
    appUrl,
  });
  if (refusal) fail(refusal);
}

if (args.demoVenue) {
  // Независимо от NODE_ENV (на VM он не задан): отказ при любом торговом ключе в env и при адресе не localhost;
  // production-приложение само отклоняет пульс и маршруты зеркала с пометкой «площадка демо».
  const refusal = demoVenueRefusal({
    production: process.env.NODE_ENV === "production",
    hasTradeKey: hasAnyTradeKey(process.env),
    appUrl,
  });
  if (refusal) fail(refusal);
}

/**
 * Клиент биржи: настоящий торговый ключ на хостах Binance или («площадка демо») ключ Binance Demo на демо-хостах —
 * тот же белый список и та же логика. null — ключа нет: только пульс «ключ не задан».
 */
function makeClient(): LiveClient | null {
  if (!args.demoVenue) return creds ? liveClient(creds) : null;
  const demo = getDemoTradingConfig();
  if (!demo)
    fail(
      "--venue demo: не задан ключ Binance Demo (BINANCE_DEMO_API_KEY / SECRET)",
    );
  return liveClient({ live: demo.credentials }, LIVE_DEMO_HOSTS);
}
const client = makeClient();
const venue = client ? liveVenue(client) : null;

let prices: { at: number; value: Map<string, number> } | null = null;
const deps: WorkerDeps | null = client
  ? {
      now: Date.now,
      // На демо-хостах прав ключа (/sapi/v1/account/apiRestrictions) нет — «площадка демо» считает их годными.
      fetchRestrictions: args.demoVenue
        ? async () => DEMO_VENUE_FLAGS
        : () => fetchLiveApiRestrictions(client),
      fetchSpotAccount: () => fetchLiveSpotAccount(client),
      fetchFuturesAccount: () => fetchLiveFuturesAccount(client),
      fetchPrices: async () => {
        if (prices && Date.now() - prices.at < PRICES_TTL_MS)
          return prices.value;
        prices = { at: Date.now(), value: await fetchTickerPrices("spot") };
        return prices.value;
      },
    }
  : null;
const memory = emptyMemory();
/** Неотправленные итоги для приложения (вход, закрытие…): досылаются следующим прогоном. */
const outbox: OutboxItem[] = [];
/** SIGTERM получен: прогон не начинает новое, процесс выходит после текущего прогона. */
let stopping = false;
/**
 * Сколько ждать конца прогона на SIGTERM: вход + защита — до TRADE_DEADLINE_MS (60 с) + отправка итога с повторами.
 * В unit — TimeoutStopSec больше этого (docs/ai/architecture.md).
 */
const STOP_GRACE_MS = 90_000;

/** Биржа реального зеркала: общая логика ордеров execute-trade на площадке Live. */
const exchange: LiveExchange | null = venue
  ? (() => {
      const ctx: TradeVenueContext = {
        venue,
        maxNotionalUsd: LIVE.notionalHardCapUsd,
        maxRiskPct: LIVE.maxRiskPct,
        autoHedge: false,
      };
      return {
        placeTrade: (req, seed) => placeTrade(req, ctx, { tradeId: seed }),
        spotOrder: (symbol, clientOrderId) =>
          fetchDemoSpotOrderByClientId(venue, symbol, clientOrderId),
        futuresOrder: (symbol, clientOrderId) =>
          fetchDemoFuturesOrder(venue, symbol, { clientOrderId }),
        algoOrder: (clientAlgoId) =>
          fetchDemoAlgoOrder(venue, { clientAlgoId }),
        closePosition: (req) => closeDemoPosition(req, venue),
        sweepLegs: (legs, overBudget) =>
          sweepTriggeredLegs(legs, overBudget, venue),
        symbolRules: (market, symbol) =>
          fetchDemoSymbolRules(market, symbol, venue),
        price: (market, symbol) => fetchDemoPrice(market, symbol, venue),
        balances: () => fetchDemoUsdtBalances(venue),
        positionMode: () => fetchDemoPositionMode(venue),
        futuresBusy: () => fetchDemoFuturesAccountBusy(venue),
        enableOneway: () => enableOnewayMode(venue),
        fills: (market, symbol) => fetchDemoFills(venue, market, symbol, 100),
        sizeEntry,
        spotSlippage: SPOT_ENTRY_SLIPPAGE,
      };
    })()
  : null;

/** POST в приложение с секретом воркера; ответ — по схеме. Ошибка — исключение (прогон ничего не открывает). */
async function post<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
): Promise<z.infer<T>> {
  let res: Response;
  try {
    res = await fetch(`${appUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        // «Площадка демо»: production-приложение такие запросы отклоняет (защита не зависит от env воркера).
        ...(args.demoVenue ? { [DEMO_VENUE_HEADER]: "demo" } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`приложение не ответило: ${describeNetworkError(error)}`);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = (data as { error?: unknown } | null)?.error;
    throw new Error(
      `${path}: приложение ответило ${res.status}${typeof reason === "string" ? `: ${reason}` : ""}`,
    );
  }
  return schema.parse(data);
}
const api = mirrorApi(post);

function send(heartbeat: LiveHeartbeat) {
  return post(
    "/api/live/heartbeat",
    toWire(heartbeat),
    liveHeartbeatReplySchema,
  );
}

let lastSummary = "";

function logPulse(heartbeat: LiveHeartbeat) {
  const summary = [
    heartbeat.verdict,
    ...heartbeat.reasons,
    heartbeat.uid?.status ?? "",
  ].join(" | ");
  const data = {
    verdict: heartbeat.verdict,
    reasons: heartbeat.reasons,
    uid: heartbeat.uid?.status ?? null,
    fixture: heartbeat.fixture,
  };
  if (summary !== lastSummary || args.once)
    log.info("live.pulse", `Пульс принят: ${heartbeat.verdict}`, data);
  else log.debug("live.pulse", `Пульс принят: ${heartbeat.verdict}`, data);
  lastSummary = summary;
  if (heartbeat.error) log.warn("live.binance", heartbeat.error);
}

async function cycle(): Promise<void> {
  // Рукопожатие после старта (ждём UID основного счёта) → один повтор сразу; дальше — по таймеру.
  const sent = await pulseWithHandshake({
    memory,
    build: async () => {
      const base = {
        version: VERSION,
        sentAt: new Date().toISOString(),
        fixture: args.fixture,
      };
      if (args.fixture) return fixtureHeartbeat(args.fixture, base);
      const pulse = {
        ...base,
        fixture: args.demoVenue ? ("demo-venue" as const) : null,
      };
      return deps ? await runCheck(deps, memory, pulse) : noKeyHeartbeat(pulse);
    },
    send: async (heartbeat) => {
      const reply = await send(heartbeat);
      logPulse(heartbeat);
      return reply;
    },
  });
  // Пульс принят — прогон реального зеркала. Фикстуры и воркер без ключа сделок не делают.
  const last = sent.at(-1);
  if (args.fixture || !exchange || !last || last.handshake) return;
  try {
    const r = await runLiveMirror({
      api,
      ex: exchange,
      now: Date.now,
      verdictOk: last.verdict === "ok",
      keyAccepted: !last.reasons.includes(KEY_REJECTED_REASON),
      outbox,
      stopRequested: () => stopping,
      onLost: (item, error) =>
        log.error(
          "live.outbox",
          `Итог «${item.kind}» не дошёл до приложения — дошлю следующим прогоном: ${error instanceof Error ? error.message : String(error)}`,
          { tradeId: "tradeId" in item.body ? item.body.tradeId : null },
        ),
    });
    if (r.flushed)
      log.info("live.outbox", `Дослано итогов прошлых прогонов: ${r.flushed}`);
    for (const c of r.reconciled)
      log.warn(
        "live.reconcile",
        `Сверка «потерянного» входа ${c.tradeId}: ${c.outcome} — ${c.message}`,
      );
    const run = r.run;
    if (
      r.closeAll ||
      (run &&
        (run.opened.length ||
          run.closed.length ||
          run.skipped ||
          run.swept.length ||
          run.deferred))
    )
      log.info(
        "live.mirror",
        `Реальное зеркало: открыто ${run?.opened.length ?? 0}, закрыто ${run?.closed.length ?? 0}, закрыто биржей ${run?.swept.length ?? 0}, пропущено ${run?.skipped ?? 0}${run?.deferred ? `, отложено ${run.deferred}` : ""}${r.closeAll ? `; «Закрыть всё»: закрыто ${r.closeAll.closed}, не закрылось ${r.closeAll.failed}` : ""}`,
        {
          opened: run?.opened ?? [],
          closed: run?.closed ?? [],
          closeAll: r.closeAll,
        },
      );
  } catch (error) {
    // Приложение недоступно или ответило ошибкой — ничего не открывается, повтор на следующем прогоне (AC11).
    log.error(
      "live.mirror",
      `Прогон реального зеркала не выполнен: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function safeCycle(): Promise<boolean> {
  try {
    await cycle();
    return true;
  } catch (error) {
    log.error(
      "live.worker",
      `Пульс не отправлен: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

log.info(
  "live.worker",
  `Воркер реального счёта ${VERSION}: ${args.fixture ? `фикстура ${args.fixture}` : args.demoVenue ? "площадка демо (Binance Demo, только локально)" : creds ? "ключ задан" : "ключ не задан"}, пульс → ${appUrl}${secret ? "" : " (без LIVE_WORKER_SECRET)"}`,
);

async function main() {
  if (args.once) {
    process.exitCode = (await safeCycle()) ? 0 : 1;
    if (outbox.length)
      log.error(
        "live.outbox",
        `Не доставлено итогов: ${outbox.length} — строки останутся pending до сверки с биржей следующим запуском`,
      );
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  let current: Promise<boolean> | null = null;
  const loop = async () => {
    if (stopping) return;
    current = safeCycle();
    await current;
    current = null;
    if (!stopping) timer = setTimeout(loop, HEARTBEAT_EVERY_MS);
  };
  /**
   * SIGTERM (systemctl restart, деплой) посреди сделки: новые входы и закрытия не начинаются, начатое доделывается
   * (вход + защита — до TRADE_DEADLINE_MS) и итог отправляется; ждём не дольше STOP_GRACE_MS, потом выходим.
   */
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    if (timer) clearTimeout(timer);
    if (current) {
      log.info(
        "live.worker",
        `${signal}: дожидаюсь конца текущего прогона (до ${STOP_GRACE_MS / 1000} с)`,
      );
      await Promise.race([
        current,
        new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS)),
      ]);
    }
    if (outbox.length)
      log.error(
        "live.outbox",
        `Остановка с недоставленными итогами: ${outbox.length} — строки останутся pending до сверки с биржей после запуска`,
      );
    log.info("live.worker", `Остановлен (${signal})`);
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
  await loop();
}

void main();
