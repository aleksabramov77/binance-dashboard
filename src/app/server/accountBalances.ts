// Остатки счетов Binance по группам активов для шапки (spec 0038): Demo — equity демо-счёта в $, Real —
// торговый субсчёт из последнего пульса воркера реального счёта (spec 0047; основной счёт — на странице
// «Портфель»). Шапка опрашивает раз в 30 с с каждой вкладки, а подписанные запросы на общем IP рискуют баном
// (spec 0014) — поэтому ответ кэшируется на процесс на 60 с, параллельные запросы ждут один поход на биржу.
// Только сервер.
import type {
  AccountBalances,
  WalletBalance,
} from "@/entities/account-balance";
import { isSilent, type LiveState } from "@/entities/live-account";
import {
  type BinanceMarket,
  resolveUsdPrice,
  type WalletEquityResult,
} from "@/shared/api/binance";
import { fetchDemoEquity } from "@/shared/api/binance/demo.server";
import {
  getDemoTradingConfig,
  getLiveSilentAfterMs,
} from "@/shared/config/env.server";
import { CooldownError } from "@/shared/lib/fetchRetry";
import { log } from "@/shared/lib/logger.server";
import { loadLastLiveState } from "./liveAccount";
import { cachedTickerPrices } from "./tickerPrices";

/** Не чаще одного похода на каждый хост Binance в минуту (AC5). */
export const BALANCES_TTL_MS = 60_000;

type Wallets = AccountBalances["demo"];

const byMarket = (cell: (m: BinanceMarket) => WalletBalance): Wallets => ({
  spot: cell("spot"),
  usdm: cell("usdm"),
  coinm: cell("coinm"),
});
const each = (balance: WalletBalance): Wallets => byMarket(() => balance);

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Причина «—» для подсказки: пауза после 429/418 — отдельным текстом, остальное — сообщение ошибки. */
export function errorHint(error: unknown): string {
  return error instanceof CooldownError
    ? "Binance ограничил запросы (429/418) — пауза, повтор позже"
    : `Ошибка: ${message(error)}`;
}

function logFailure(account: string, error: unknown) {
  // Пауза уже записана как binance.cooldown — повторять её каждую минуту не нужно.
  log[error instanceof CooldownError ? "debug" : "warn"](
    "accounts.balances",
    `Остатки ${account} не получены`,
    { error: message(error) },
  );
}

/** Оценка кошелька демо-счёта → ячейка шапки: активы без цены — оговоркой в подсказке. */
export function demoWallet(result: WalletEquityResult): WalletBalance {
  if (!result.ok) return { usd: null, hint: errorHint(result.error) };
  return {
    usd: result.usd,
    hint: result.unpriced.length
      ? `Без цены в $, не учтены: ${result.unpriced.join(", ")}`
      : null,
  };
}

async function loadDemo(): Promise<Wallets> {
  const config = getDemoTradingConfig();
  if (!config)
    return each({
      usd: null,
      hint: "Ключ Binance Demo не задан (BINANCE_DEMO_API_KEY / SECRET)",
    });
  let prices: Map<string, number>;
  try {
    // Цены — из общего кэша с бюджетами лаборатории: без второго ticker/price к api.binance.com.
    prices = await cachedTickerPrices("spot");
  } catch (error) {
    logFailure("Demo (цены)", error);
    return each({
      usd: null,
      hint: `Нет цен Binance для оценки в $. ${errorHint(error)}`,
    });
  }
  const equity = await fetchDemoEquity(config.credentials, (asset) =>
    resolveUsdPrice(asset, prices),
  );
  return byMarket((m) => {
    const r = equity[m];
    if (!r.ok) logFailure(`Demo ${m}`, r.error);
    return demoWallet(r);
  });
}

export const COINM_REAL_HINT = "COIN-M на реальном счёте не торгуется";

/**
 * R в шапке (spec 0047, AC6): остатки торгового субсчёта из последнего пульса. Spot — equity в $ (без цен —
 * USDT free + locked), USDⓈ-M — walletBalance + unrealizedProfit. Нет пульса или остатков — «—» с причиной.
 */
export function realWallets(
  state: LiveState | null,
  now: number,
  silentAfterMs: number,
): Wallets {
  const coinm: WalletBalance = { usd: null, hint: COINM_REAL_HINT };
  const none = (hint: string): Wallets => ({
    spot: { usd: null, hint },
    usdm: { usd: null, hint },
    coinm,
  });
  if (!state)
    return none(
      "Воркер реального счёта не подключён: пульса ещё не было (Настройки → Реальный счёт)",
    );
  const h = state.heartbeat;
  if (h.verdict === "no-key")
    return none("У воркера реального счёта не задан ключ субсчёта");
  if (h.verdict === "blocked")
    return none(
      "Ключ реального счёта заблокирован — причины в Настройки → Реальный счёт",
    );
  const at = state.receivedAt;
  const hint = isSilent(at, now, silentAfterMs)
    ? "субсчёт; воркер молчит — остаток на время пульса"
    : "субсчёт";
  const missing = h.balancesNote ?? "остатка нет в пульсе";
  const spot: WalletBalance = h.spot
    ? h.spot.equityUsd !== null
      ? {
          usd: h.spot.equityUsd,
          hint: h.spot.unpriced.length
            ? `${hint}; без цены в $, не учтены: ${h.spot.unpriced.join(", ")}`
            : hint,
          at,
        }
      : {
          usd: h.spot.usdtFree + h.spot.usdtLocked,
          hint: `${hint}; только USDT — цен для оценки в $ не было`,
          at,
        }
    : { usd: null, hint: `Субсчёт: ${missing}`, at };
  const usdm: WalletBalance = h.usdm
    ? { usd: h.usdm.walletBalance + h.usdm.unrealizedProfit, hint, at }
    : { usd: null, hint: `Субсчёт: ${missing}`, at };
  return { spot, usdm, coinm };
}

async function loadReal(): Promise<Wallets> {
  try {
    return realWallets(
      await loadLastLiveState(),
      Date.now(),
      getLiveSilentAfterMs(),
    );
  } catch (error) {
    logFailure("Real (пульс)", error);
    return {
      ...each({ usd: null, hint: `Пульс не прочитан: ${message(error)}` }),
      coinm: { usd: null, hint: COINM_REAL_HINT },
    };
  }
}

type Cache = {
  at: number;
  value: AccountBalances | null;
  pending: Promise<AccountBalances> | null;
};
const key = Symbol.for("binance-dashboard.accountBalances");
const g = globalThis as typeof globalThis & { [key]?: Cache };

/** Остатки Demo и Real по группам; свежий кэш — без похода на биржу. Ошибки — в подсказках, не исключением. */
export async function getAccountBalances(): Promise<AccountBalances> {
  g[key] ??= { at: 0, value: null, pending: null };
  const cache = g[key];
  if (cache.value && Date.now() - cache.at < BALANCES_TTL_MS)
    return cache.value;
  cache.pending ??= Promise.all([loadDemo(), loadReal()])
    .then(([demo, real]) => {
      const value = { demo, real, at: new Date().toISOString() };
      cache.value = value;
      cache.at = Date.now();
      return value;
    })
    .finally(() => {
      cache.pending = null;
    });
  return cache.pending;
}

/** Для тестов: сбросить кэш процесса. */
export function clearAccountBalancesCache() {
  delete g[key];
}
