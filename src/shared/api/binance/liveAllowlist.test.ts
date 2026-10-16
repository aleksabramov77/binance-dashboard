import { describe, expect, it } from "vitest";
import {
  assertLiveAllowed,
  forbiddenPathWord,
  isStrictLivePath,
  LIVE_ALLOWLIST,
  LIVE_FORBIDDEN_PATH_WORDS,
  LiveRequestDeniedError,
  type LiveRoute,
  liveDenyReason,
} from "./liveAllowlist";

const MONEY_MOVES: LiveRoute[] = [
  {
    method: "POST",
    market: "spot",
    path: "/sapi/v1/capital/withdraw/apply",
  },
  { method: "POST", market: "spot", path: "/sapi/v1/asset/transfer" },
  {
    method: "GET",
    market: "spot",
    path: "/sapi/v1/capital/config/getall",
  },
  {
    method: "POST",
    market: "spot",
    path: "/sapi/v1/sub-account/universalTransfer",
  },
  { method: "POST", market: "spot", path: "/sapi/v1/margin/loan" },
  {
    method: "POST",
    market: "spot",
    path: "/sapi/v1/margin/borrow-repay",
  },
  { method: "POST", market: "spot", path: "/sapi/v1/loan/borrow" },
  { method: "POST", market: "usdm", path: "/fapi/v1/asset/Universal" },
  { method: "POST", market: "spot", path: "/sapi/v1/futures/transfer" },
];

describe("белый список клиента реального счёта", () => {
  it("список — ровно явный перечень: чтение счёта (0047) и ордера Spot / USDⓈ-M (0049)", () => {
    expect(
      LIVE_ALLOWLIST.map((r) => `${r.method} ${r.market} ${r.path}`),
    ).toEqual([
      "GET spot /sapi/v1/account/apiRestrictions",
      "GET spot /api/v3/account",
      "GET usdm /fapi/v3/account",
      "POST spot /api/v3/order",
      "GET spot /api/v3/order",
      "DELETE spot /api/v3/order",
      "POST spot /api/v3/orderList/otoco",
      "POST spot /api/v3/orderList/oto",
      "POST spot /api/v3/orderList/oco",
      "GET spot /api/v3/openOrders",
      "GET spot /api/v3/myTrades",
      "GET usdm /fapi/v3/balance",
      "GET usdm /fapi/v1/positionSide/dual",
      "POST usdm /fapi/v1/positionSide/dual",
      "POST usdm /fapi/v1/marginType",
      "POST usdm /fapi/v1/leverage",
      "GET usdm /fapi/v3/positionRisk",
      "GET usdm /fapi/v1/openOrders",
      "GET usdm /fapi/v1/openAlgoOrders",
      "POST usdm /fapi/v1/order",
      "GET usdm /fapi/v1/order",
      "DELETE usdm /fapi/v1/order",
      "POST usdm /fapi/v1/algoOrder",
      "GET usdm /fapi/v1/algoOrder",
      "DELETE usdm /fapi/v1/algoOrder",
      "GET usdm /fapi/v1/userTrades",
    ]);
  });

  it("история счёта, переводы и `/sapi` кроме прав ключа — не в списке", () => {
    for (const r of LIVE_ALLOWLIST) {
      expect(r.path).not.toMatch(/allOrders|allAlgoOrders|income|asset/i);
      if (r.path.startsWith("/sapi"))
        expect(r.path).toBe("/sapi/v1/account/apiRestrictions");
    }
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

  it.each([
    "/sapi/v1/asset/tr%61nsfer",
    "/sapi/v1/capital/withdr%61w/apply",
    "/api/v3//account",
    "/api/v3/account?x=1",
    "/api/v3/account#frag",
    "/api/v3/../account",
    "/api/v3/account.json",
    "api/v3/account",
    "/api/v3/account/",
    "",
  ])("путь не в строгом формате «%s» — отказ, даже если он в списке", (path) => {
    const route = { method: "GET" as const, market: "spot" as const, path };
    expect(liveDenyReason(route, [...LIVE_ALLOWLIST, route])).toMatch(
      /не в строгом формате/,
    );
  });

  it("пути белого списка — в строгом формате", () => {
    for (const r of LIVE_ALLOWLIST) expect(isStrictLivePath(r.path)).toBe(true);
  });

  it("отвергает запросы вне списка: другой путь, другой метод, другой рынок", () => {
    expect(
      liveDenyReason({
        method: "POST",
        market: "spot",
        path: "/api/v3/order/test",
      }),
    ).toMatch(/нет в белом списке/);
    expect(
      liveDenyReason({
        method: "POST",
        market: "usdm",
        path: "/api/v3/order",
      }),
    ).toMatch(/нет в белом списке/);
    expect(
      liveDenyReason({
        method: "DELETE",
        market: "spot",
        path: "/api/v3/account",
      }),
    ).toMatch(/нет в белом списке/);
    expect(
      liveDenyReason({
        method: "GET",
        market: "usdm",
        path: "/api/v3/order/test",
      }),
    ).toMatch(/нет в белом списке/);
    expect(
      liveDenyReason({
        method: "GET",
        market: "usdm",
        path: "/api/v3/account",
      }),
    ).toMatch(/нет в белом списке/);
  });
});
