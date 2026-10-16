// Логика воркера реального счёта (spec 0047): цикл проверки ключа → пульс. Сеть и время внедряются (WorkerDeps),
// поэтому цикл покрыт тестами без Binance. Запуск, env и отправка пульса — scripts/live-worker.ts.
import {
  isHandshake,
  LIVE_FIXTURES,
  type LiveFixture,
  type LiveHeartbeat,
  type LiveHeartbeatReply,
  liveHeartbeatSchema,
} from "@/entities/live-account";
import {
  checkAccountUid,
  evaluateRestrictions,
  isKeyRejected,
  isUidBlocking,
  KEY_REJECTED_REASON,
  type LiveFuturesAccount,
  type LiveSpotAccount,
  MAIN_ACCOUNT_REASON,
  type MainAccountUid,
  mergeMainAccount,
  type RestrictionsVerdict,
  resolveUsdPrice,
  sumUsd,
} from "@/shared/api/binance";

/** Права ключа перечитываются при старте и каждые 10 минут (AC2); пока ключ заблокирован — каждый цикл. */
export const RESTRICTIONS_EVERY_MS = 10 * 60_000;
/**
 * Предельный возраст последней успешной проверки прав: перепроверка падает (сеть, 429/418) дольше — оценка «годится»
 * больше не держится, блокировка «права не перепроверены» до удачной проверки.
 */
export const MAX_RESTRICTIONS_AGE_MS = 2 * RESTRICTIONS_EVERY_MS;
/** Пульс — раз в минуту (AC4). */
export const HEARTBEAT_EVERY_MS = 60_000;

export interface WorkerDeps {
  now: () => number;
  /** GET /sapi/v1/account/apiRestrictions — ответ как есть. */
  fetchRestrictions: () => Promise<unknown>;
  fetchSpotAccount: () => Promise<LiveSpotAccount>;
  fetchFuturesAccount: () => Promise<LiveFuturesAccount>;
  /** Публичные цены Spot (без ключа) — для equity в $. */
  fetchPrices: () => Promise<Map<string, number>>;
}

/** Память воркера между циклами. Оценка при ошибке биржи не сбрасывается: блокировка не снимается (AC8). */
export interface WorkerMemory {
  restrictions: {
    verdict: RestrictionsVerdict;
    checkedAt: number | null;
  } | null;
  /** UID основного счёта из ответа приложения; undefined — ещё не известен. */
  mainAccount: MainAccountUid;
  /** Последняя UID-проверка: при сбое чтения аккаунта действует она. */
  uid: LiveHeartbeat["uid"];
}

export const emptyMemory = (): WorkerMemory => ({
  restrictions: null,
  mainAccount: undefined,
  uid: null,
});

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Binance не принял ключ (401, -2015…): статус и код — из BinanceApiError, без зависимости от класса. */
const isRejected = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return isKeyRejected({
    status: typeof status === "number" ? status : undefined,
    code: typeof code === "number" ? code : undefined,
  });
};

const blockedVerdict = (reason: string): RestrictionsVerdict => ({
  ok: false,
  flags: null,
  reasons: [reason],
  warnings: [],
});

type Base = Pick<LiveHeartbeat, "version" | "sentAt" | "fixture">;

/** Пульс «ключ не задан» (AC8): воркер работает, но на биржу не ходит. */
export function noKeyHeartbeat(base: Base): LiveHeartbeat {
  return {
    ...base,
    verdict: "no-key",
    reasons: [],
    warnings: [],
    restrictions: { flags: null, checkedAt: null },
    uid: null,
    spot: null,
    usdm: null,
    balancesNote: "ключ субсчёта не задан (BINANCE_TRADE_API_KEY / SECRET)",
    error: null,
  };
}

async function refreshRestrictions(
  deps: WorkerDeps,
  memory: WorkerMemory,
): Promise<string | null> {
  const r = memory.restrictions;
  const now = deps.now();
  const due =
    !r ||
    !r.verdict.ok ||
    r.checkedAt === null ||
    now - r.checkedAt >= RESTRICTIONS_EVERY_MS;
  if (!due) return null;
  try {
    memory.restrictions = {
      verdict: evaluateRestrictions(await deps.fetchRestrictions()),
      checkedAt: now,
    };
    return null;
  } catch (error) {
    if (isRejected(error)) {
      memory.restrictions = {
        verdict: blockedVerdict(KEY_REJECTED_REASON),
        checkedAt: now,
      };
      return null;
    }
    // Биржа недоступна, 429/418: прежняя оценка остаётся; первой проверки не было — блокировка до неё.
    const last = memory.restrictions;
    if (
      last?.verdict.ok &&
      last.checkedAt !== null &&
      now - last.checkedAt > MAX_RESTRICTIONS_AGE_MS
    )
      // «Годится» без перепроверки дольше предела не держим: за это время у ключа могли включить вывод.
      memory.restrictions = {
        verdict: blockedVerdict(
          `права ключа не перепроверены ${Math.round((now - last.checkedAt) / 60_000)} мин: ${message(error)}`,
        ),
        checkedAt: null,
      };
    memory.restrictions ??= {
      verdict: blockedVerdict(
        "права ключа ещё не проверены: Binance не ответил",
      ),
      checkedAt: null,
    };
    return `Права ключа не прочитаны: ${message(error)}`;
  }
}

async function spotBalance(
  deps: WorkerDeps,
  account: LiveSpotAccount,
): Promise<NonNullable<LiveHeartbeat["spot"]>> {
  const usdt = account.balances.find((b) => b.asset === "USDT");
  const rows = account.balances.map((b) => ({
    asset: b.asset,
    amount: b.free + b.locked,
  }));
  const needPrices = rows.some((r) => r.asset !== "USDT" && r.amount !== 0);
  let equityUsd: number | null = null;
  let unpriced: string[] = [];
  try {
    const prices = needPrices ? await deps.fetchPrices() : new Map();
    ({ usd: equityUsd, unpriced } = sumUsd(rows, (asset) =>
      resolveUsdPrice(asset, prices),
    ));
  } catch {
    // Нет цен — остаётся USDT; equity в $ неизвестна.
    equityUsd = null;
  }
  return {
    usdtFree: usdt?.free ?? 0,
    usdtLocked: usdt?.locked ?? 0,
    equityUsd,
    unpriced,
  };
}

/**
 * Один цикл: права ключа → (годится) аккаунт Spot, UID-проверка, остатки → (фьючерсы разрешены) USDⓈ-M.
 * Заблокирован — дальше проверки прав на биржу не идёт. Ошибки биржи — в поле error, оценка при них не снимается.
 */
export async function runCheck(
  deps: WorkerDeps,
  memory: WorkerMemory,
  base: Base,
): Promise<LiveHeartbeat> {
  const errors: string[] = [];
  const restrictionsError = await refreshRestrictions(deps, memory);
  if (restrictionsError) errors.push(restrictionsError);
  // refreshRestrictions всегда оставляет оценку.
  const r = memory.restrictions ?? {
    verdict: blockedVerdict("права ключа не проверены"),
    checkedAt: null,
  };
  const restrictions = {
    flags: r.verdict.flags,
    checkedAt:
      r.checkedAt === null ? null : new Date(r.checkedAt).toISOString(),
  };
  const pulse = (
    over: Partial<LiveHeartbeat> & Pick<LiveHeartbeat, "verdict">,
  ): LiveHeartbeat => ({
    ...base,
    reasons: [],
    warnings: r.verdict.warnings,
    restrictions,
    // «Ждём UID» — только в ветке UID-проверки; блокировка по другой причине не должна выглядеть рукопожатием.
    uid: memory.uid?.status === "pending" ? null : memory.uid,
    spot: null,
    usdm: null,
    balancesNote: null,
    error: errors.join("; ") || null,
    ...over,
  });

  if (!r.verdict.ok)
    return pulse({
      verdict: "blocked",
      reasons: r.verdict.reasons,
      balancesNote: "ключ заблокирован — остатки не читаются",
    });

  let spot: LiveHeartbeat["spot"] = null;
  const notes: string[] = [];
  try {
    const account = await deps.fetchSpotAccount();
    memory.uid = checkAccountUid(account.uid, memory.mainAccount);
    if (!isUidBlocking(memory.uid.status))
      spot = await spotBalance(deps, account);
  } catch (error) {
    if (isRejected(error)) {
      memory.restrictions = {
        verdict: blockedVerdict(KEY_REJECTED_REASON),
        checkedAt: deps.now(),
      };
      return pulse({
        verdict: "blocked",
        reasons: [KEY_REJECTED_REASON],
        balancesNote: "ключ заблокирован — остатки не читаются",
      });
    }
    // UID субсчёта из рукопожатия без UID основного ничего не доказывает — «не прочитан», блокировка сохранится.
    if (memory.uid?.status === "pending") memory.uid = null;
    errors.push(`Аккаунт Spot не прочитан: ${message(error)}`);
    notes.push("Spot не прочитан");
  }
  // AC3 fail-closed: UID субсчёта ещё ни разу не прочитан — проверку «не основной счёт» не сделать.
  if (!memory.uid)
    return pulse({
      verdict: "blocked",
      reasons: [
        "UID субсчёта не прочитан (аккаунт Spot недоступен) — проверка «не основной счёт» невозможна",
      ],
      balancesNote: "проверка UID не пройдена — остатки не показываются",
    });
  // Ключ основного счёта, UID основного ещё не получен (рукопожатие после старта) или не прочитан — блокировка
  // без остатков: остатки основного счёта не должны попасть в шапку.
  if (isUidBlocking(memory.uid.status))
    return pulse({
      verdict: "blocked",
      reasons: [
        memory.uid.status === "same"
          ? MAIN_ACCOUNT_REASON
          : (memory.uid.note ?? "проверка UID не пройдена"),
      ],
      uid: memory.uid,
      balancesNote:
        memory.uid.status === "same"
          ? "ключ основного счёта — остатки не показываются"
          : "проверка UID не пройдена — остатки не показываются",
    });

  let usdm: LiveHeartbeat["usdm"] = null;
  if (r.verdict.flags?.enableFutures) {
    try {
      const f = await deps.fetchFuturesAccount();
      usdm = {
        walletBalance: f.totalWalletBalance,
        availableBalance: f.availableBalance,
        unrealizedProfit: f.totalUnrealizedProfit,
      };
    } catch (error) {
      errors.push(`Аккаунт USDⓈ-M не прочитан: ${message(error)}`);
      notes.push("USDⓈ-M не прочитан");
    }
  } else notes.push("фьючерсы недоступны у ключа");

  return pulse({
    verdict: "ok",
    uid: memory.uid,
    spot,
    usdm,
    balancesNote: notes.join("; ") || null,
  });
}

/** Готовые пульсы для локальной проверки карточки (`--fixture`): без биржи и без ключа. */
export function fixtureHeartbeat(
  fixture: LiveFixture,
  base: Base,
): LiveHeartbeat {
  const flags = {
    ipRestrict: true,
    enableReading: true,
    enableSpotAndMarginTrading: true,
    enableFutures: true,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    permitsUniversalTransfer: false,
    enableMargin: false,
  };
  const checkedAt = base.sentAt;
  if (fixture === "blocked") {
    const bad = { ...flags, ipRestrict: false, enableWithdrawals: true };
    const verdict = evaluateRestrictions(bad);
    return {
      ...base,
      verdict: "blocked",
      reasons: verdict.reasons,
      warnings: verdict.warnings,
      restrictions: { flags: bad, checkedAt },
      uid: null,
      spot: null,
      usdm: null,
      balancesNote: "ключ заблокирован — остатки не читаются",
      error: null,
    };
  }
  if (fixture === "main-account")
    return {
      ...base,
      verdict: "blocked",
      reasons: [MAIN_ACCOUNT_REASON],
      warnings: [],
      restrictions: { flags, checkedAt },
      uid: { status: "same", note: MAIN_ACCOUNT_REASON },
      spot: null,
      usdm: null,
      balancesNote: "ключ основного счёта — остатки не показываются",
      error: null,
    };
  return {
    ...base,
    verdict: "ok",
    reasons: [],
    warnings: [],
    restrictions: { flags, checkedAt },
    uid: { status: "different", note: null },
    spot: { usdtFree: 62.5, usdtLocked: 0, equityUsd: 70.12, unpriced: [] },
    usdm: { walletBalance: 30, availableBalance: 30, unrealizedProfit: 0 },
    balancesNote: null,
    error: null,
  };
}

/**
 * Задан ли торговый ключ хоть частично: для запрета фикстуры достаточно любого из BINANCE_TRADE_API_KEY /
 * BINANCE_TRADE_API_SECRET (неполная пара — тоже признак окружения с настоящим ключом).
 */
export const hasAnyTradeKey = (
  env: Record<string, string | undefined>,
): boolean =>
  Boolean(
    env.BINANCE_TRADE_API_KEY?.trim() || env.BINANCE_TRADE_API_SECRET?.trim(),
  );

/**
 * Один пульс по таймеру: собрать → отправить → принять UID основного счёта. Если это было рукопожатие и UID теперь
 * известен — ровно один повтор сразу, без рекурсии; дальше — следующий цикл по таймеру. Возвращает отправленные пульсы.
 */
export async function pulseWithHandshake(input: {
  memory: WorkerMemory;
  build: () => Promise<LiveHeartbeat>;
  send: (heartbeat: LiveHeartbeat) => Promise<LiveHeartbeatReply>;
}): Promise<LiveHeartbeat[]> {
  const sent: LiveHeartbeat[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const heartbeat = await input.build();
    const reply = await input.send(heartbeat);
    applyReply(input.memory, reply.mainAccount);
    sent.push(heartbeat);
    if (!isHandshake(heartbeat) || input.memory.mainAccount === undefined)
      break;
  }
  return sent;
}

/** Ответ приложения: UID основного счёта — поверх известного (ошибка чтения не затирает известный UID). */
export function applyReply(
  memory: WorkerMemory,
  mainAccount: MainAccountUid,
): void {
  memory.mainAccount = mergeMainAccount(memory.mainAccount, mainAccount);
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Куда можно слать пульс с секретом: https на любой хост или http только на localhost/127.0.0.1. Иначе секрет
 * ушёл бы открытым текстом. null — можно.
 */
export function appUrlRefusal(appUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    return `LIVE_APP_URL не распознан (${appUrl})`;
  }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOCAL_HOSTS.includes(url.hostname))
    return null;
  return `LIVE_APP_URL должен быть https (http — только localhost/127.0.0.1): ${url.protocol}//${url.hostname}`;
}

export const isLiveFixture = (value: string): value is LiveFixture =>
  (LIVE_FIXTURES as readonly string[]).includes(value);

/**
 * Фикстура — только для локальной проверки: отказ, если задан торговый ключ или адрес приложения не localhost.
 * null — можно.
 */
export function fixtureRefusal(input: {
  hasTradeKey: boolean;
  appUrl: string;
}): string | null {
  if (input.hasTradeKey)
    return "фикстура запрещена: задан BINANCE_TRADE_API_KEY или BINANCE_TRADE_API_SECRET — фикстура только для проверки без ключа";
  let host: string;
  try {
    host = new URL(input.appUrl).hostname;
  } catch {
    return `фикстура запрещена: LIVE_APP_URL не распознан (${input.appUrl})`;
  }
  return LOCAL_HOSTS.includes(host)
    ? null
    : `фикстура запрещена: LIVE_APP_URL не localhost/127.0.0.1 (${host})`;
}

/** Пульс перед отправкой — через ту же схему, что у приложения: лишнего (ключа) в нём быть не может. */
export const toWire = (heartbeat: LiveHeartbeat): LiveHeartbeat =>
  liveHeartbeatSchema.parse(heartbeat);
