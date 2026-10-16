import { describe, expect, it } from "vitest";
import {
  checkAccountUid,
  evaluateRestrictions,
  isKeyRejected,
  isUidBlocking,
  LIVE_KEY_FLAGS,
  type LiveKeyFlags,
  liveFuturesAccountSchema,
  liveSpotAccountSchema,
  mergeMainAccount,
} from "./liveRestrictions";

// Ответ apiRestrictions по документации Binance + ключ, который годится.
const GOOD: LiveKeyFlags & Record<string, unknown> = {
  ipRestrict: true,
  createTime: 1623840271000,
  enableReading: true,
  enableWithdrawals: false,
  enableInternalTransfer: false,
  enableMargin: false,
  enableFutures: true,
  permitsUniversalTransfer: false,
  enableVanillaOptions: false,
  enableFixApiTrade: false,
  enableFixReadOnly: true,
  enableSpotAndMarginTrading: true,
  enablePortfolioMarginTrading: false,
};

describe("evaluateRestrictions", () => {
  it("ключ с чтением, Spot, фьючерсами и IP, без вывода и переводов — годится", () => {
    const v = evaluateRestrictions(GOOD);
    expect(v).toMatchObject({ ok: true, reasons: [], warnings: [] });
    expect(v.flags?.enableFutures).toBe(true);
  });

  it("неизвестные поля не ломают оценку", () => {
    expect(evaluateRestrictions({ ...GOOD, somethingNew: 1 }).ok).toBe(true);
  });

  it.each([
    ["ipRestrict", false, /Restrict access to trusted IPs only/],
    ["enableReading", false, /Enable Reading/],
    ["enableSpotAndMarginTrading", false, /Enable Spot & Margin Trading/],
    ["enableWithdrawals", true, /разрешён вывод средств.*Enable Withdrawals/],
    ["enableInternalTransfer", true, /Enable Internal Transfer/],
    ["permitsUniversalTransfer", true, /Permits Universal Transfer/],
    ["enableMargin", true, /Enable Margin Loan, Repay & Transfer/],
  ] as const)("%s = %s — блокировка с причиной", (flag, value, reason) => {
    const v = evaluateRestrictions({ ...GOOD, [flag]: value });
    expect(v.ok).toBe(false);
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0]).toMatch(reason);
  });

  it("enableFutures = false — не блокировка, а предупреждение", () => {
    const v = evaluateRestrictions({ ...GOOD, enableFutures: false });
    expect(v.ok).toBe(true);
    expect(v.warnings).toEqual([expect.stringMatching(/фьючерсы недоступны/)]);
  });

  it("причины — по каждому нарушенному пункту", () => {
    const v = evaluateRestrictions({
      ...GOOD,
      ipRestrict: false,
      enableWithdrawals: true,
      enableMargin: true,
    });
    expect(v.reasons).toHaveLength(3);
  });

  it("нет обязательного поля или не тот тип — блокировка «неизвестный ответ»", () => {
    for (const flag of LIVE_KEY_FLAGS) {
      const { [flag]: _, ...rest } = GOOD;
      const v = evaluateRestrictions(rest);
      expect(v.ok).toBe(false);
      expect(v.flags).toBeNull();
      expect(v.reasons[0]).toMatch(new RegExp(`неизвестный ответ.*${flag}`));
    }
    expect(
      evaluateRestrictions({ ...GOOD, enableWithdrawals: "false" }).ok,
    ).toBe(false);
    expect(evaluateRestrictions(null).ok).toBe(false);
    expect(evaluateRestrictions([]).ok).toBe(false);
  });
});

describe("isKeyRejected", () => {
  it("401, -2015, -2014, -1022 — Binance не принял ключ", () => {
    expect(isKeyRejected({ status: 401 })).toBe(true);
    expect(isKeyRejected({ status: 400, code: -2015 })).toBe(true);
    expect(isKeyRejected({ status: 400, code: -2014 })).toBe(true);
    expect(isKeyRejected({ status: 400, code: -1022 })).toBe(true);
  });
  it("429, 418, 5xx и прочие коды — не отказ ключа", () => {
    expect(isKeyRejected({ status: 429 })).toBe(false);
    expect(isKeyRejected({ status: 418 })).toBe(false);
    expect(isKeyRejected({ status: 503 })).toBe(false);
    expect(isKeyRejected({ status: 400, code: -1021 })).toBe(false);
  });
});

describe("checkAccountUid", () => {
  it("UID совпал с основным — блокировка «ключ основного счёта»", () => {
    expect(checkAccountUid(42, { uid: 42 })).toEqual({
      status: "same",
      note: "Это ключ основного счёта — нужен ключ субсчёта",
    });
  });
  it("UID другой — субсчёт", () => {
    expect(checkAccountUid(42, { uid: 7 })).toEqual({
      status: "different",
      note: null,
    });
  });
  it("нет read-only ключа — проверка пропущена с причиной (не блокирует)", () => {
    const r = checkAccountUid(42, {
      uid: null,
      reason: "read-only ключ не задан",
      transient: false,
    });
    expect(r).toEqual({
      status: "skipped",
      note: "проверка пропущена: read-only ключ не задан",
    });
    expect(isUidBlocking(r.status)).toBe(false);
  });
  it("UID основного ещё не известен или не прочитан — блокировка (fail-closed)", () => {
    expect(checkAccountUid(42, undefined).status).toBe("pending");
    const unread = checkAccountUid(42, {
      uid: null,
      reason: "429",
      transient: true,
    });
    expect(unread.status).toBe("unread");
    expect(unread.note).toMatch(/UID основного счёта не прочитан \(429\)/);
    for (const s of ["pending", "unread", "same"] as const)
      expect(isUidBlocking(s)).toBe(true);
    expect(isUidBlocking("different")).toBe(false);
  });
});

describe("mergeMainAccount", () => {
  const error = { uid: null, reason: "сеть", transient: true } as const;
  it("ошибка чтения не затирает известный UID", () => {
    expect(mergeMainAccount({ uid: 7 }, error)).toEqual({ uid: 7 });
  });
  it("ошибка без известного UID — остаётся ошибкой (блокировка)", () => {
    expect(mergeMainAccount(undefined, error)).toEqual(error);
  });
  it("новый UID и «ключа нет» заменяют известное; нет ответа — без изменений", () => {
    expect(mergeMainAccount({ uid: 7 }, { uid: 8 })).toEqual({ uid: 8 });
    const noKey = { uid: null, reason: "нет ключа", transient: false };
    expect(mergeMainAccount({ uid: 7 }, noKey)).toEqual(noKey);
    expect(mergeMainAccount({ uid: 7 }, undefined)).toEqual({ uid: 7 });
  });
});

describe("схемы аккаунтов", () => {
  it("Spot: uid и остатки строками → числа; без uid — ошибка", () => {
    const a = liveSpotAccountSchema.parse({
      uid: 354937868,
      accountType: "SPOT",
      balances: [{ asset: "USDT", free: "10.5", locked: "1" }],
    });
    expect(a.balances[0]).toMatchObject({ free: 10.5, locked: 1 });
    expect(liveSpotAccountSchema.safeParse({ balances: [] }).success).toBe(
      false,
    );
  });
  it("USDⓈ-M: итоги счёта строками → числа", () => {
    expect(
      liveFuturesAccountSchema.parse({
        totalWalletBalance: "126.72469206",
        availableBalance: "120",
        totalUnrealizedProfit: "-1.5",
        assets: [],
      }),
    ).toMatchObject({
      totalWalletBalance: 126.72469206,
      availableBalance: 120,
      totalUnrealizedProfit: -1.5,
    });
  });
});
