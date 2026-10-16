// Белый список запросов клиента реального счёта (Live, spec 0047). Чистый модуль: его проверяет тест, а
// live.server.ts вызывает assertLiveAllowed до подписи и сети. Запрос вне списка не уходит.

export type LiveMethod = "GET" | "POST" | "DELETE";

export interface LiveRoute {
  method: LiveMethod;
  /** Хост без протокола: api.binance.com, fapi.binance.com. */
  host: string;
  path: string;
}

export const LIVE_HOSTS = {
  spot: "api.binance.com",
  usdm: "fapi.binance.com",
} as const;

/**
 * Что клиенту реального счёта можно. В spec 0047 — только чтение: права ключа, аккаунт Spot (UID и остатки),
 * аккаунт USDⓈ-M. Ордера добавит задача «Реальное зеркало» — отдельными строками, с тестом.
 */
export const LIVE_ALLOWLIST: readonly LiveRoute[] = [
  {
    method: "GET",
    host: LIVE_HOSTS.spot,
    path: "/sapi/v1/account/apiRestrictions",
  },
  { method: "GET", host: LIVE_HOSTS.spot, path: "/api/v3/account" },
  { method: "GET", host: LIVE_HOSTS.usdm, path: "/fapi/v3/account" },
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
      r.host === route.host &&
      r.path === route.path,
  );
  return listed
    ? null
    : `${route.method} ${route.host}${route.path} нет в белом списке клиента реального счёта`;
}

/** Бросает LiveRequestDeniedError, если запрос не разрешён. Вызывается до подписи и сети. */
export function assertLiveAllowed(
  route: LiveRoute,
  allowlist: readonly LiveRoute[] = LIVE_ALLOWLIST,
): void {
  const reason = liveDenyReason(route, allowlist);
  if (reason) throw new LiveRequestDeniedError(`Live: ${reason}`);
}
