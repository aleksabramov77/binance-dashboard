// Белый список запросов клиента реального счёта (Live, spec 0047, 0049). Чистый модуль: его проверяет тест, а
// live.server.ts вызывает assertLiveAllowed до подписи и сети. Запрос вне списка не уходит.

export type LiveMethod = "GET" | "POST" | "DELETE";
/** Рынок запроса: spot — api.binance.com (`/api`, `/sapi`), usdm — fapi.binance.com. Хост берёт клиент по рынку. */
export type LiveMarket = "spot" | "usdm";

export interface LiveRoute {
  method: LiveMethod;
  market: LiveMarket;
  path: string;
}

/** Хосты реального счёта (без протокола). Площадка «демо» для локальной проверки подставляет демо-хосты. */
export const LIVE_HOSTS = {
  spot: "api.binance.com",
  usdm: "fapi.binance.com",
} as const;

const allow = (
  method: LiveMethod,
  market: LiveMarket,
  path: string,
): LiveRoute => ({ method, market, path });

/**
 * Что клиенту реального счёта можно — явный перечень. spec 0047 — чтение: права ключа, аккаунт Spot (UID и
 * остатки), аккаунт USDⓈ-M. spec 0049 — ордера и чтение Spot и USDⓈ-M для реального зеркала (вход, защита, выход,
 * сверка ног, «Закрыть всё», PnL по исполнениям). Переводов, выводов, займов и истории счёта в списке нет.
 */
export const LIVE_ALLOWLIST: readonly LiveRoute[] = [
  // spec 0047: проверка ключа и остатки.
  allow("GET", "spot", "/sapi/v1/account/apiRestrictions"),
  allow("GET", "spot", "/api/v3/account"),
  allow("GET", "usdm", "/fapi/v3/account"),
  // spec 0049, Spot: вход OTOCO/OTO, защита OCO/стоп, продажа по рынку, перечитывание и снятие своих ордеров.
  allow("POST", "spot", "/api/v3/order"),
  allow("GET", "spot", "/api/v3/order"),
  allow("DELETE", "spot", "/api/v3/order"),
  allow("POST", "spot", "/api/v3/orderList/otoco"),
  allow("POST", "spot", "/api/v3/orderList/oto"),
  allow("POST", "spot", "/api/v3/orderList/oco"),
  allow("GET", "spot", "/api/v3/openOrders"),
  allow("GET", "spot", "/api/v3/myTrades"),
  // spec 0049, USDⓈ-M: режим позиций (One-way), маржа и плечо, вход и закрытие по рынку, algo TP/SL, позиции.
  allow("GET", "usdm", "/fapi/v3/balance"),
  allow("GET", "usdm", "/fapi/v1/positionSide/dual"),
  allow("POST", "usdm", "/fapi/v1/positionSide/dual"),
  allow("POST", "usdm", "/fapi/v1/marginType"),
  allow("POST", "usdm", "/fapi/v1/leverage"),
  allow("GET", "usdm", "/fapi/v3/positionRisk"),
  allow("GET", "usdm", "/fapi/v1/openOrders"),
  allow("GET", "usdm", "/fapi/v1/openAlgoOrders"),
  allow("POST", "usdm", "/fapi/v1/order"),
  allow("GET", "usdm", "/fapi/v1/order"),
  allow("DELETE", "usdm", "/fapi/v1/order"),
  allow("POST", "usdm", "/fapi/v1/algoOrder"),
  allow("GET", "usdm", "/fapi/v1/algoOrder"),
  allow("DELETE", "usdm", "/fapi/v1/algoOrder"),
  allow("GET", "usdm", "/fapi/v1/userTrades"),
];

/**
 * Слова в пути, которые означают движение денег (вывод, переводы, займы). Такой путь отвергается всегда —
 * даже если его по ошибке добавят в LIVE_ALLOWLIST.
 */
export const LIVE_FORBIDDEN_PATH_WORDS = [
  "withdraw",
  "transfer",
  "capital",
  "sub-account",
  "loan",
  "borrow",
  "repay",
  "universal",
] as const;

export class LiveRequestDeniedError extends Error {
  override name = "LiveRequestDeniedError";
}

/**
 * Строгий формат пути: только латиница, цифры, «_», «-» и одиночные «/». Без «%» (URL-кодирование вроде
 * `tr%61nsfer` обошло бы поиск слов), «?», «#», «.» и «//». Путь не в этом формате отвергается — и в запросе, и
 * значит ни одна такая строка белого списка не сработает.
 */
export const LIVE_PATH_FORMAT = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;

export const isStrictLivePath = (path: string): boolean =>
  LIVE_PATH_FORMAT.test(path);

/** Слово движения денег в пути (без учёта регистра); null — нет. */
export function forbiddenPathWord(path: string): string | null {
  const lower = path.toLowerCase();
  return LIVE_FORBIDDEN_PATH_WORDS.find((w) => lower.includes(w)) ?? null;
}

/**
 * Причина отказа; null — запрос разрешён. Сначала строгий формат пути, затем запрет движения денег, потом сверка
 * со списком.
 */
export function liveDenyReason(
  route: LiveRoute,
  allowlist: readonly LiveRoute[] = LIVE_ALLOWLIST,
): string | null {
  if (!isStrictLivePath(route.path))
    return `путь ${route.path} не в строгом формате (только латиница, цифры, «_», «-», «/»): клиенту реального счёта запрещено`;
  const word = forbiddenPathWord(route.path);
  if (word)
    return `путь ${route.path} — движение денег («${word}»): клиенту реального счёта запрещено`;
  const listed = allowlist.some(
    (r) =>
      r.method === route.method &&
      r.market === route.market &&
      r.path === route.path,
  );
  return listed
    ? null
    : `${route.method} ${route.market} ${route.path} нет в белом списке клиента реального счёта`;
}

/** Бросает LiveRequestDeniedError, если запрос не разрешён. Вызывается до подписи и сети. */
export function assertLiveAllowed(
  route: LiveRoute,
  allowlist: readonly LiveRoute[] = LIVE_ALLOWLIST,
): void {
  const reason = liveDenyReason(route, allowlist);
  if (reason) throw new LiveRequestDeniedError(`Live: ${reason}`);
}
