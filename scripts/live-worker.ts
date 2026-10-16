// `pnpm live:worker` — воркер реального счёта (spec 0047). Отдельный процесс: только у него торговый ключ субсчёта
// (BINANCE_TRADE_API_KEY / SECRET). Раз в минуту проверяет ключ (права — при старте и каждые 10 мин) и шлёт пульс
// в приложение: POST ${LIVE_APP_URL}/api/live/heartbeat, Bearer LIVE_WORKER_SECRET. Входящих соединений не
// принимает, DATABASE_URL и Telegram ему не нужны, журнал — stdout/stderr (на VM — journald), файлов не пишет.
// Сделок нет: клиент реального счёта в этой задаче умеет только читать (src/shared/api/binance/liveAllowlist.ts).
//
//   pnpm live:worker                 — цикл раз в минуту (на VM — systemd-сервис binance-live)
//   pnpm live:worker --once          — один пульс и выход (код 1 — пульс не принят)
//   pnpm live:worker --once --fixture ok|blocked|main-account
//                                    — готовый пульс без биржи: только без ключа и только на localhost
//
// Сборка в один файл для VM: `pnpm live:build` → dist/live-worker.mjs (`node dist/live-worker.mjs --once`).
import { existsSync, readFileSync } from "node:fs";
import {
  type LiveFixture,
  type LiveHeartbeat,
  liveHeartbeatReplySchema,
} from "@/entities/live-account";
import {
  fetchLiveApiRestrictions,
  fetchLiveFuturesAccount,
  fetchLiveSpotAccount,
} from "@/shared/api/binance/live.server";
import { fetchTickerPrices } from "@/shared/api/binance/public.server";
import {
  getLiveAppUrl,
  getLiveTradeCredentials,
  getLiveWorkerSecret,
} from "@/shared/config/env.server";
import { describeNetworkError } from "@/shared/lib/fetchRetry";
import { disableLogFiles, log } from "@/shared/lib/logger.server";
import {
  emptyMemory,
  fixtureHeartbeat,
  fixtureRefusal,
  HEARTBEAT_EVERY_MS,
  isLiveFixture,
  noKeyHeartbeat,
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
} {
  const once = argv.includes("--once");
  const i = argv.indexOf("--fixture");
  if (i === -1) return { once, fixture: null };
  const value = argv[i + 1] ?? "";
  if (!isLiveFixture(value))
    throw new Error(
      `--fixture: ожидается ok | blocked | main-account, получено «${value}»`,
    );
  return { once, fixture: value };
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
const secret = getLiveWorkerSecret();
const creds = getLiveTradeCredentials();
if (args.fixture) {
  const refusal = fixtureRefusal({ hasTradeKey: creds !== null, appUrl });
  if (refusal) fail(refusal);
}

let prices: { at: number; value: Map<string, number> } | null = null;
const deps: WorkerDeps | null = creds
  ? {
      now: Date.now,
      fetchRestrictions: () => fetchLiveApiRestrictions(creds),
      fetchSpotAccount: () => fetchLiveSpotAccount(creds),
      fetchFuturesAccount: () => fetchLiveFuturesAccount(creds),
      fetchPrices: async () => {
        if (prices && Date.now() - prices.at < PRICES_TTL_MS)
          return prices.value;
        prices = { at: Date.now(), value: await fetchTickerPrices("spot") };
        return prices.value;
      },
    }
  : null;
const memory = emptyMemory();

async function send(heartbeat: LiveHeartbeat) {
  let res: Response;
  try {
    res = await fetch(`${appUrl}/api/live/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify(toWire(heartbeat)),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`приложение не ответило: ${describeNetworkError(error)}`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const reason = (body as { error?: unknown } | null)?.error;
    throw new Error(
      `приложение ответило ${res.status}${typeof reason === "string" ? `: ${reason}` : ""}`,
    );
  }
  return liveHeartbeatReplySchema.parse(body);
}

let lastSummary = "";

async function cycle(): Promise<void> {
  const base = {
    version: VERSION,
    sentAt: new Date().toISOString(),
    fixture: args.fixture,
  };
  const heartbeat = args.fixture
    ? fixtureHeartbeat(args.fixture, base)
    : deps
      ? await runCheck(deps, memory, base)
      : noKeyHeartbeat(base);
  const reply = await send(heartbeat);
  if (reply.mainAccount !== undefined) memory.mainAccount = reply.mainAccount;

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

  // Первый пульс не знал UID основного счёта — приложение прислало его: сразу проверяем и шлём снова.
  if (heartbeat.uid?.status === "pending" && memory.mainAccount !== undefined)
    await cycle();
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
  `Воркер реального счёта ${VERSION}: ${args.fixture ? `фикстура ${args.fixture}` : creds ? "ключ задан" : "ключ не задан"}, пульс → ${appUrl}${secret ? "" : " (без LIVE_WORKER_SECRET)"}`,
);

async function main() {
  if (args.once) {
    process.exitCode = (await safeCycle()) ? 0 : 1;
    return;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const loop = async () => {
    await safeCycle();
    timer = setTimeout(loop, HEARTBEAT_EVERY_MS);
  };
  const stop = (signal: string) => {
    if (timer) clearTimeout(timer);
    log.info("live.worker", `Остановлен (${signal})`);
    process.exit(0);
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
  await loop();
}

void main();
