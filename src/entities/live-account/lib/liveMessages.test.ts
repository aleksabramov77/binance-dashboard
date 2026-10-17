import { describe, expect, it } from "vitest";
import { nextUtcMidnight, utcDayStart } from "./liveDay";
import {
  liveCloseFailedText,
  liveDailyLimitText,
  liveEntryText,
  liveExitText,
  liveHeldText,
  liveOutcomeLine,
  liveOutcomeMark,
  liveUnprotectedText,
} from "./liveMessages";
import { livePrice } from "./money";

const s = {
  experimentId: "S98",
  symbol: "BTCUSDT",
  market: "usdm" as const,
  direction: "long" as const,
};

// Intl ru-RU разделяет разряды неразрывным пробелом.
const nb = (text: string) => text.replaceAll(" ", "\u00a0");

describe("вход (spec 0068, AC1–AC2)", () => {
  const entry = {
    notionalUsd: 50,
    raised: "minNotional" as const,
    entryPrice: 80030,
    stopLoss: 78429.4,
    takeProfit: 83231.2,
  };

  it("🟡 и по строке: заголовок с рынком, объём с причиной, цена входа, SL и TP с процентом от входа", () => {
    expect(liveEntryText(s, entry)).toBe(
      [
        "🟡 Вход · S98 BTCUSDT long · USDⓈ-M",
        "Объём: $50,00 (минимум биржи)",
        `Цена входа: ${nb("80 030")}`,
        `SL: ${nb("78 429,4")} (−2,0 %)`,
        `TP: ${nb("83 231,2")} (+4,0 %)`,
      ].join("\n"),
    );
  });

  it("без TP — без строки TP; объём не поднят — без причины; Spot — в заголовке", () => {
    const text = liveEntryText(
      { ...s, market: "spot" },
      { ...entry, raised: null, takeProfit: null },
    );
    expect(text.split("\n")).toHaveLength(4);
    expect(text).not.toMatch(/TP|минимум/);
    expect(text).toMatch(
      /^🟡 Вход · S98 BTCUSDT long · Spot\nОбъём: \$50,00\n/,
    );
  });

  it("причина объёма: «минимум биржи» — только для minNotional", () => {
    expect(liveEntryText(s, { ...entry, raised: "spotStop" })).toMatch(
      /Объём: \$50,00 \(стоп после комиссии должен пройти минимум ордера\)/,
    );
  });

  it("цены — без хвостов float, 6 значащих цифр (AC2)", () => {
    const text = liveEntryText(
      { ...s, symbol: "XUSDT" },
      {
        ...entry,
        entryPrice: 81.66221436553849,
        stopLoss: 80.02897007822772,
        takeProfit: null,
      },
    );
    expect(text).toMatch(/Цена входа: 81,6622\n/);
    expect(text).toMatch(/SL: 80,029 \(−2,0 %\)$/);
    expect(livePrice(0.0000123456789)).toBe("0,0000123457");
  });

  it("цена входа не известна — «нет данных», проценты не считаются", () => {
    const text = liveEntryText(s, { ...entry, entryPrice: null });
    expect(text).toMatch(/Цена входа: нет данных/);
    expect(text).not.toMatch(/%/);
  });
});

describe("итог (spec 0068, AC3)", () => {
  const exit = {
    realizedPnl: 0.84,
    closedBy: "tp",
    entryPrice: 80030,
    exitPrice: 83230,
    feesUsd: 0.05,
    heldMs: (2 * 60 + 15) * 60_000,
    balance: { usd: 512.4, asOf: null },
  };

  it("прибыль — 🟢 +$X, причина и цены, комиссии и время, баланс", () => {
    expect(liveExitText(s, exit)).toBe(
      [
        "🟢 +$0,84 · S98 BTCUSDT long · USDⓈ-M",
        `Закрыта по TP: ${nb("80 030")} → ${nb("83 230")}`,
        "Комиссии: $0,05 · в сделке 2 ч 15 мин",
        "Баланс субсчёта: $512,40",
      ].join("\n"),
    );
  });

  it("убыток — 🔴 −$X по SL; «Закрыть всё» и paper-сделка — своими словами", () => {
    expect(
      liveExitText(s, { ...exit, realizedPnl: -1.02, closedBy: "sl" }),
    ).toMatch(/^🔴 −\$1,02 · S98 BTCUSDT long · USDⓈ-M\nЗакрыта по SL: /);
    expect(liveExitText(s, { ...exit, closedBy: "close_all" })).toMatch(
      /\nЗакрыта по «Закрыть всё»: /,
    );
    expect(liveExitText(s, { ...exit, closedBy: "mirror" })).toMatch(
      /\nЗакрыта вслед за paper-сделкой: /,
    );
  });

  it("PnL неизвестен — ⚪ и пояснение про пороги автовыключения своей строкой", () => {
    const text = liveExitText(s, {
      ...exit,
      realizedPnl: null,
      exitPrice: null,
      feesUsd: null,
    });
    expect(text).toMatch(/^⚪ PnL неизвестен · /);
    expect(text).toMatch(/: [^\n]+ → нет данных\n/);
    expect(text).toMatch(/\nКомиссии: нет данных · /);
    expect(text).toMatch(
      /\n⚠️ Исполнения и цена не прочитаны — в порогах автовыключения сделка считается убыточной$/,
    );
    // PnL ровно 0 — тоже ⚪.
    expect(liveExitText(s, { ...exit, realizedPnl: 0 })).toMatch(
      /^⚪ \$0,00 · /,
    );
  });

  it("оценка, остаток монеты и «после N попыток» — каждая своей строкой", () => {
    const text = liveExitText(s, {
      ...exit,
      realizedPnl: -2.5,
      closedBy: "mirror",
      pnlEstimated: true,
      leftover: { qty: 0.00000986, asset: "BTC", usd: 0.81 },
      attempts: 3,
    });
    expect(text).toMatch(/^🔴 ≈ −\$2,50 · /);
    expect(text.split("\n").slice(4)).toEqual([
      "≈ PnL — оценка по ценам входа и выхода (исполнения не прочитаны)",
      "Остаток 0.00000986 BTC ≈ $0,81 на субсчёте, в PnL не входит",
      "Закрыта после 3 попыток",
    ]);
  });

  it("заголовок итога всегда полный, с рынком: ответ может уйти без цитаты (вход удалён, AC6)", () => {
    expect(liveExitText(s, exit)).toMatch(
      /^🟢 \+\$0,84 · S98 BTCUSDT long · USDⓈ-M\n/,
    );
    expect(liveExitText({ ...s, market: "spot" }, exit)).toMatch(
      /^🟢 \+\$0,84 · S98 BTCUSDT long · Spot\n/,
    );
  });

  it("баланс — по пульсу со временем; нет — «Баланс: нет данных» (AC4)", () => {
    expect(
      liveExitText(s, { ...exit, balance: { usd: 30, asOf: "12:40 UTC" } }),
    ).toMatch(/\nБаланс субсчёта: \$30,00 \(на 12:40 UTC\)/);
    expect(liveExitText(s, { ...exit, balance: null })).toMatch(
      /\nБаланс: нет данных/,
    );
  });

  it("время в сделке", () => {
    expect(liveHeldText(20_000)).toBe("меньше минуты");
    expect(liveHeldText(45 * 60_000)).toBe("45 мин");
    expect(liveHeldText(3 * 3_600_000)).toBe("3 ч");
    expect(liveHeldText(27 * 3_600_000 + 60_000)).toBe("1 д 3 ч");
  });

  it("строка «Итог» для сообщения о входе и отметка (AC5)", () => {
    expect(liveOutcomeLine({ realizedPnl: 0.84, closedBy: "tp" })).toBe(
      "Итог: 🟢 +$0,84 (TP)",
    );
    expect(
      liveOutcomeLine({
        realizedPnl: -1.02,
        closedBy: "sl",
        pnlEstimated: true,
      }),
    ).toBe("Итог: 🔴 ≈ −$1,02 (SL)");
    expect(liveOutcomeLine({ realizedPnl: null, closedBy: "mirror" })).toBe(
      "Итог: ⚪ PnL неизвестен (закрыта paper-сделка)",
    );
    expect(liveOutcomeMark(0.84)).toBe("good");
    expect(liveOutcomeMark(-1)).toBe("bad");
    expect(liveOutcomeMark(0)).toBeNull();
    expect(liveOutcomeMark(null)).toBeNull();
  });
});

describe("тревоги сделки (spec 0068, AC7)", () => {
  it("без защиты — что случилось и что сделать своими строками", () => {
    expect(liveUnprotectedText(s, "Стоп не поставлен.")).toBe(
      [
        "⚠️ Реальная сделка без защиты · S98 BTCUSDT long · USDⓈ-M",
        "Что случилось: Стоп не поставлен.",
        "Что сделать: закройте позицию на Binance вручную или нажмите «Закрыть всё».",
      ].join("\n"),
    );
  });

  it("не закрылась — что случилось и что дальше", () => {
    expect(liveCloseFailedText(s, "-1021 Timestamp.").split("\n")).toEqual([
      "⚠️ Реальная позиция не закрылась · S98 BTCUSDT long · USDⓈ-M",
      "Что случилось: -1021 Timestamp.",
      "Закрытие повторяется каждый прогон воркера, пока позиция не закроется.",
    ]);
  });
});

describe("дневной лимит", () => {
  it("эксперимент и сумма", () => {
    expect(liveDailyLimitText("S98", -15.2)).toMatch(
      /S98 −\$15,20 за сутки \(лимит −\$15\)/,
    );
  });
});

describe("сутки UTC", () => {
  it("начало суток и следующая полночь", () => {
    const now = Date.parse("2026-10-16T21:30:00+03:00");
    expect(utcDayStart(now).toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(nextUtcMidnight(now).toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });
});
