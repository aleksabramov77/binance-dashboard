import { describe, expect, it } from "vitest";
import type { AccountBalances } from "@/entities/account-balance";
import type { MarketBudget } from "@/entities/experiment";
import {
  balanceNotes,
  chipTitle,
  REAL_LABEL,
  walletHint,
  walletText,
} from "./describe";

const GROUPS = [
  { market: "spot", code: "SPOT" },
  { market: "usdm", code: "FT:USDM" },
  { market: "coinm", code: "FT:COINM" },
] as const;

const budget: MarketBudget = {
  market: "usdm",
  initial: 200_000,
  realized: 150,
  fees: 12,
  unrealized: -50,
  openTrades: 2,
  equity: 200_100,
  change: 100,
  changePct: 0.0005,
};

describe("walletText", () => {
  it("число — в $, null — «—», нет данных — «…»", () => {
    expect(walletText({ usd: null, hint: "нет ключа" })).toBe("—");
    expect(walletText(undefined)).toBe("…");
    expect(walletText({ usd: 1_500, hint: null })).toMatch(/1\s500/);
  });
});

describe("walletHint", () => {
  it("остаток из пульса — «субсчёт, пульс <время>»; без времени — только причина", () => {
    expect(
      walletHint({ usd: 10, hint: "субсчёт", at: "2026-10-16T10:00:00.000Z" }),
    ).toMatch(/^субсчёт, пульс \S/);
    expect(walletHint({ usd: null, hint: "нет ключа" })).toBe("нет ключа");
    expect(walletHint({ usd: 1, hint: null })).toBeNull();
    expect(walletHint(undefined)).toBeNull();
  });
});

describe("chipTitle", () => {
  it("расшифровывает Paper, D и R и даёт причину «—»", () => {
    const title = chipTitle({
      code: "FT:USDM",
      label: "USDⓈ-M",
      paper: budget,
      paperError: null,
      demo: { usd: 5_000, hint: null },
      real: { usd: null, hint: "Воркер реального счёта не подключён" },
      balancesError: null,
    });
    expect(title).toContain("FT:USDM — USDⓈ-M");
    expect(title).toContain("Paper (симуляция лаборатории");
    expect(title).toContain("Открытых позиций: 2");
    expect(title).toMatch(/D — Demo-счёт Binance .*: 5\s000/);
    expect(title).toContain(
      `${REAL_LABEL}: — (Воркер реального счёта не подключён)`,
    );
  });

  it("ошибка запроса остатков — «—» с её текстом у D и R", () => {
    const title = chipTitle({
      code: "SPOT",
      label: "Spot",
      paper: undefined,
      paperError: "Бюджеты недоступны",
      demo: undefined,
      real: undefined,
      balancesError: "Сервер ответил 502",
    });
    expect(title).toContain("— (Бюджеты недоступны)");
    expect(title.match(/— \(Сервер ответил 502\)/g)).toHaveLength(2);
  });
});

describe("balanceNotes", () => {
  it("общая причина счёта — без групп, частная — с кодами групп", () => {
    const balances: AccountBalances = {
      at: "2026-10-16T10:00:00.000Z",
      demo: {
        spot: { usd: 10_000, hint: null },
        usdm: { usd: 5_000, hint: "Без цены в $, не учтены: SNDKB" },
        coinm: { usd: null, hint: "Ошибка: 502" },
      },
      real: {
        spot: { usd: null, hint: "Нет ключа" },
        usdm: { usd: null, hint: "Нет ключа" },
        coinm: { usd: null, hint: "Нет ключа" },
      },
    };
    expect(balanceNotes(balances, GROUPS)).toEqual([
      {
        account: "Demo",
        codes: ["FT:USDM"],
        hint: "Без цены в $, не учтены: SNDKB",
      },
      { account: "Demo", codes: ["FT:COINM"], hint: "Ошибка: 502" },
      { account: "Real", codes: [], hint: "Нет ключа" },
    ]);
  });
});
