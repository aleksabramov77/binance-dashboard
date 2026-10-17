import { describe, expect, it } from "vitest";
import { evaluateRestrictions } from "./liveRestrictions";
import {
  evaluateReadKeyRestrictions,
  type ReadKeyFlags,
} from "./readRestrictions";

// Ответ apiRestrictions по документации Binance: read-only ключ с ограничением по IP.
const READ_ONLY: ReadKeyFlags & Record<string, unknown> = {
  ipRestrict: true,
  createTime: 1623840271000,
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableMargin: false,
  enableFutures: false,
  permitsUniversalTransfer: false,
  enableVanillaOptions: false,
  enableFixApiTrade: false,
  enableFixReadOnly: true,
  enableSpotAndMarginTrading: false,
  enablePortfolioMarginTrading: false,
};

describe("evaluateReadKeyRestrictions", () => {
  it("чтение + IP, всё остальное выключено — годится", () => {
    expect(evaluateReadKeyRestrictions(READ_ONLY)).toEqual({
      ok: true,
      flags: expect.objectContaining({ enableReading: true }),
      reasons: [],
    });
  });

  it.each<[keyof ReadKeyFlags, boolean, RegExp]>([
    ["enableWithdrawals", true, /вывод средств.*Enable Withdrawals/],
    ["enableInternalTransfer", true, /внутренние переводы/],
    ["permitsUniversalTransfer", true, /универсальные переводы/],
    ["enableSpotAndMarginTrading", true, /торговля Spot/],
    ["enableFutures", true, /фьючерсами.*Enable Futures/],
    ["enableMargin", true, /займы и переводы маржи/],
    ["ipRestrict", false, /ограничения по IP/],
    ["enableReading", false, /не включено чтение/],
    ["enableVanillaOptions", true, /опционами.*Enable Vanilla Options/],
    [
      "enablePortfolioMarginTrading",
      true,
      /Portfolio Margin.*Enable Portfolio Margin Trading/,
    ],
  ])("%s = %s — отказ с причиной", (flag, value, reason) => {
    const verdict = evaluateReadKeyRestrictions({
      ...READ_ONLY,
      [flag]: value,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reasons).toEqual([expect.stringMatching(reason)]);
  });

  it("несколько нарушений — по причине на каждое", () => {
    const verdict = evaluateReadKeyRestrictions({
      ...READ_ONLY,
      ipRestrict: false,
      enableWithdrawals: true,
      enableFutures: true,
    });
    expect(verdict.reasons).toHaveLength(3);
  });

  it("нет полей опционов и Portfolio Margin — считаются выключенными, ключ годится", () => {
    const {
      enableVanillaOptions: _options,
      enablePortfolioMarginTrading: _pm,
      ...withoutOptional
    } = READ_ONLY;
    const verdict = evaluateReadKeyRestrictions(withoutOptional);
    expect(verdict.ok).toBe(true);
    expect(verdict.flags).toMatchObject({
      enableVanillaOptions: false,
      enablePortfolioMarginTrading: false,
    });
  });

  it("неизвестный ответ — отказ, флаги не прочитаны", () => {
    const verdict = evaluateReadKeyRestrictions({ enableReading: true });
    expect(verdict).toMatchObject({ ok: false, flags: null });
    expect(verdict.reasons[0]).toMatch(/неизвестный ответ.*ipRestrict/);
  });

  it("правила воркера не тронуты: опционы и Portfolio Margin воркеру не мешают", () => {
    const trading = {
      ...READ_ONLY,
      enableSpotAndMarginTrading: true,
      enableFutures: true,
      enableVanillaOptions: true,
      enablePortfolioMarginTrading: true,
    };
    expect(evaluateRestrictions(trading).ok).toBe(true);
  });

  it("правила воркера не тронуты: торговый ключ годится воркеру и не годится как read-only", () => {
    const trading = {
      ...READ_ONLY,
      enableSpotAndMarginTrading: true,
      enableFutures: true,
    };
    expect(evaluateRestrictions(trading).ok).toBe(true);
    expect(evaluateReadKeyRestrictions(trading).ok).toBe(false);
  });
});
