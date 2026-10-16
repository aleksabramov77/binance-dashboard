// Остатки счетов Binance по группам активов для шапки (spec 0038): Demo — equity демо-счёта в $, Real —
// кошельки read-only ключа. Шапка опрашивает раз в 30 с с каждой вкладки, а подписанные запросы на общем IP
// рискуют баном (spec 0014) — поэтому ответ кэшируется на процесс на 60 с, параллельные запросы ждут один
// поход на биржу. Только сервер.
import type {
  AccountBalances,
  WalletBalance,
} from "@/entities/account-balance";
import {
  type BinanceMarket,
  resolveUsdPrice,
  type WalletEquityResult,
  walletsByMarket,
} from "@/shared/api/binance";
import { fetchWalletBalances } from "@/shared/api/binance/account.server";
import { fetchDemoEquity } from "@/shared/api/binance/demo.server";
import {
  getBinanceCredentials,
  getDemoTradingConfig,
} from "@/shared/config/env.server";
import { CooldownError } from "@/shared/lib/fetchRetry";
import { log } from "@/shared/lib/logger.server";
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

async function loadReal(): Promise<Wallets> {
  const creds = getBinanceCredentials();
  if (!creds)
    return each({
      usd: null,
      hint: "Read-only ключ Binance не задан (BINANCE_API_KEY / SECRET)",
    });
  try {
    const wallets = walletsByMarket(await fetchWalletBalances(creds));
    return byMarket((m) => {
      const usd = wallets[m];
      return usd === null
        ? { usd: null, hint: "Кошелька нет в ответе Binance" }
        : { usd, hint: null };
    });
  } catch (error) {
    logFailure("Real", error);
    return each({ usd: null, hint: errorHint(error) });
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
