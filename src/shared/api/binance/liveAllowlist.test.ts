import { describe, expect, it } from "vitest";
import {
  assertLiveAllowed,
  forbiddenPathWord,
  LIVE_ALLOWLIST,
  LIVE_FORBIDDEN_PATH_WORDS,
  LIVE_HOSTS,
  LiveRequestDeniedError,
  type LiveRoute,
  liveDenyReason,
} from "./liveAllowlist";

const MONEY_MOVES: LiveRoute[] = [
  {
    method: "POST",
    host: LIVE_HOSTS.spot,
    path: "/sapi/v1/capital/withdraw/apply",
  },
  { method: "POST", host: LIVE_HOSTS.spot, path: "/sapi/v1/asset/transfer" },
  {
    method: "GET",
    host: LIVE_HOSTS.spot,
    path: "/sapi/v1/capital/config/getall",
  },
  {
    method: "POST",
    host: LIVE_HOSTS.spot,
    path: "/sapi/v1/sub-account/universalTransfer",
  },
  { method: "POST", host: LIVE_HOSTS.spot, path: "/sapi/v1/margin/loan" },
  {
    method: "POST",
    host: LIVE_HOSTS.spot,
    path: "/sapi/v1/margin/borrow-repay",
  },
  { method: "POST", host: LIVE_HOSTS.spot, path: "/sapi/v1/loan/borrow" },
  { method: "POST", host: LIVE_HOSTS.usdm, path: "/fapi/v1/asset/Universal" },
  { method: "POST", host: LIVE_HOSTS.spot, path: "/sapi/v1/futures/transfer" },
];

describe("белый список клиента реального счёта", () => {
  it("в списке только чтение: права ключа, аккаунт Spot, аккаунт USDⓈ-M", () => {
    expect(LIVE_ALLOWLIST.every((r) => r.method === "GET")).toBe(true);
    expect(LIVE_ALLOWLIST.map((r) => `${r.host}${r.path}`)).toEqual([
      "api.binance.com/sapi/v1/account/apiRestrictions",
      "api.binance.com/api/v3/account",
      "fapi.binance.com/fapi/v3/account",
    ]);
  });

  it("ни один путь списка не содержит слов движения денег", () => {
    for (const r of LIVE_ALLOWLIST)
      expect(forbiddenPathWord(r.path)).toBeNull();
  });

  it("разрешает пути списка", () => {
    for (const r of LIVE_ALLOWLIST) expect(liveDenyReason(r)).toBeNull();
  });

  it.each(MONEY_MOVES)("отвергает $method $path", (route) => {
    expect(() => assertLiveAllowed(route)).toThrow(LiveRequestDeniedError);
  });

  it("отвергает вывод, переводы и займы, даже если их добавили в список", () => {
    const poisoned = [...LIVE_ALLOWLIST, ...MONEY_MOVES];
    for (const route of MONEY_MOVES)
      expect(liveDenyReason(route, poisoned)).toMatch(/движение денег/);
  });

  it("слова запрета — без учёта регистра и все из ТЗ", () => {
    expect(LIVE_FORBIDDEN_PATH_WORDS).toEqual(
      expect.arrayContaining([
        "withdraw",
        "transfer",
        "capital",
        "sub-account",
        "loan",
        "borrow",
        "universal",
      ]),
    );
    expect(forbiddenPathWord("/sapi/v1/Sub-Account/list")).toBe("sub-account");
  });

  it("отвергает запросы вне списка: ордер, другой метод, другой хост", () => {
    expect(
      liveDenyReason({
        method: "POST",
        host: LIVE_HOSTS.spot,
        path: "/api/v3/order",
      }),
    ).toMatch(/нет в белом списке/);
    expect(
      liveDenyReason({
        method: "DELETE",
        host: LIVE_HOSTS.spot,
        path: "/api/v3/account",
      }),
    ).toMatch(/нет в белом списке/);
    expect(
      liveDenyReason({
        method: "GET",
        host: "demo-api.binance.com",
        path: "/api/v3/account",
      }),
    ).toMatch(/нет в белом списке/);
    expect(
      liveDenyReason({
        method: "GET",
        host: LIVE_HOSTS.usdm,
        path: "/api/v3/account",
      }),
    ).toMatch(/нет в белом списке/);
  });
});
