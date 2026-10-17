import { describe, expect, it } from "vitest";
import { nextUtcMidnight, utcDayStart } from "./liveDay";
import {
  type LiveCardEntry,
  type LiveCardExit,
  liveCardText,
  liveCardUrgent,
  liveDailyLimitText,
  liveHeldText,
} from "./liveMessages";
import { livePrice } from "./money";

const s = {
  experimentId: "S98",
  symbol: "BTCUSDT",
  market: "usdm" as const,
  direction: "long" as const,
};

// Intl ru-RU разделяет разряды неразрывным пробелом.
const nb = (text: string) => text.replaceAll(" ", " ");

const entry: LiveCardEntry = {
  notionalUsd: 50,
  raised: "minNotional",
  entryPrice: 80030,
  stopLoss: 78429.4,
  takeProfit: 83231.2,
  openedAt: "2026-10-18T10:25:31.000Z",
};

/** Строки входа — одинаковые во всех статусах карточки. */
const entryLines = [
  "Объём: $50,00 (минимум биржи)",
  `Цена входа: ${nb("80 030")}`,
  `SL: ${nb("78 429,4")} (−2,0 %)`,
  `TP: ${nb("83 231,2")} (+4,0 %)`,
];

describe("карточка сделки: ход входа (spec 0068, вариант B)", () => {
  it("⏳ вход исполнен, ставлю SL/TP — данные входа и время входа, тихо", () => {
    const status = { kind: "filled" } as const;
    expect(liveCardText(s, entry, status)).toBe(
      [
        "⏳ Вход исполнен, ставлю SL/TP · S98 BTCUSDT long · USDⓈ-M",
        ...entryLines,
        "Вход: 18.10 10:25 UTC",
      ].join("\n"),
    );
    expect(liveCardUrgent(status)).toBe(false);
  });

  it("🟡 защищена — начинается с 🟡 (AC1), тихо; без TP — «SL стоит» и без строки TP", () => {
    expect(liveCardText(s, entry, { kind: "protected" })).toMatch(
      /^🟡 Открыта, SL\/TP стоят · S98 BTCUSDT long · USDⓈ-M\n/,
    );
    expect(liveCardUrgent({ kind: "protected" })).toBe(false);
    const text = liveCardText(
      { ...s, market: "spot" },
      { ...entry, takeProfit: null, raised: null },
      { kind: "protected" },
    );
    expect(text).toMatch(/^🟡 Открыта, SL стоит · S98 BTCUSDT long · Spot\n/);
    expect(text).not.toMatch(/TP:|минимум/);
  });

  it("причина объёма: «минимум биржи» — только для minNotional", () => {
    expect(
      liveCardText(s, { ...entry, raised: "spotStop" }, { kind: "protected" }),
    ).toMatch(
      /Объём: \$50,00 \(стоп после комиссии должен пройти минимум ордера\)/,
    );
  });

  it("цены — без хвостов float, 6 значащих цифр (AC2)", () => {
    const text = liveCardText(
      { ...s, symbol: "XUSDT" },
      {
        ...entry,
        entryPrice: 81.66221436553849,
        stopLoss: 80.02897007822772,
        takeProfit: null,
      },
      { kind: "protected" },
    );
    expect(text).toMatch(/\nЦена входа: 81,6622\n/);
    expect(text).toMatch(/\nSL: 80,029 \(−2,0 %\)\n/);
    expect(livePrice(0.0000123456789)).toBe("0,0000123457");
  });

  it("цена входа и объём не известны — «нет данных», проценты не считаются; стопа нет — «SL: нет»", () => {
    const text = liveCardText(
      s,
      { ...entry, entryPrice: null, notionalUsd: null, stopLoss: null },
      { kind: "protected" },
    );
    expect(text).toMatch(/Объём: нет данных/);
    expect(text).toMatch(/Цена входа: нет данных/);
    expect(text).toMatch(/\nSL: нет\n/);
    expect(text).not.toMatch(/%/);
  });
});

describe("карточка сделки: закрыта (spec 0068, AC3)", () => {
  const exit: LiveCardExit = {
    realizedPnl: 0.84,
    closedBy: "tp",
    exitPrice: 83230,
    feesUsd: 0.05,
    heldMs: (2 * 60 + 15) * 60_000,
    balance: { usd: 512.4, asOf: null },
  };
  const closed = (over: Partial<LiveCardExit> = {}) =>
    liveCardText(s, entry, { kind: "closed", exit: { ...exit, ...over } });

  it("прибыль — 🟢 +$X, данные входа, причина и цены, комиссии и время, баланс, время входа; со звуком", () => {
    expect(closed()).toBe(
      [
        "🟢 +$0,84 · S98 BTCUSDT long · USDⓈ-M",
        ...entryLines,
        `Закрыта по TP: ${nb("80 030")} → ${nb("83 230")}`,
        "Комиссии: $0,05 · в сделке 2 ч 15 мин",
        "Баланс субсчёта: $512,40",
        "Вход: 18.10 10:25 UTC",
      ].join("\n"),
    );
    expect(liveCardUrgent({ kind: "closed", exit })).toBe(true);
  });

  it("убыток — 🔴 −$X по SL; «Закрыть всё» и paper-сделка — своими словами", () => {
    expect(closed({ realizedPnl: -1.02, closedBy: "sl" })).toMatch(
      /^🔴 −\$1,02 · S98 BTCUSDT long · USDⓈ-M\n[\s\S]*\nЗакрыта по SL: /,
    );
    expect(closed({ closedBy: "close_all" })).toMatch(
      /\nЗакрыта по «Закрыть всё»: /,
    );
    expect(closed({ closedBy: "mirror" })).toMatch(
      /\nЗакрыта вслед за paper-сделкой: /,
    );
  });

  it("PnL неизвестен — ⚪ и пояснение про пороги автовыключения своей строкой; PnL 0 — тоже ⚪", () => {
    const text = closed({ realizedPnl: null, exitPrice: null, feesUsd: null });
    expect(text).toMatch(/^⚪ PnL неизвестен · /);
    expect(text).toMatch(/: [^\n]+ → нет данных\n/);
    expect(text).toMatch(/\nКомиссии: нет данных · /);
    expect(text).toMatch(
      /\n⚠️ Исполнения и цена не прочитаны — в порогах автовыключения сделка считается убыточной\n/,
    );
    expect(closed({ realizedPnl: 0 })).toMatch(/^⚪ \$0,00 · /);
  });

  it("оценка, остаток монеты и «после N попыток» — каждая своей строкой", () => {
    const text = closed({
      realizedPnl: -2.5,
      closedBy: "mirror",
      pnlEstimated: true,
      leftover: { qty: 0.00000986, asset: "BTC", usd: 0.81 },
      attempts: 3,
    });
    expect(text).toMatch(/^🔴 ≈ −\$2,50 · /);
    expect(text.split("\n").slice(-4)).toEqual([
      "≈ PnL — оценка по ценам входа и выхода (исполнения не прочитаны)",
      "Остаток 0.00000986 BTC ≈ $0,81 на субсчёте, в PnL не входит",
      "Закрыта после 3 попыток",
      "Вход: 18.10 10:25 UTC",
    ]);
  });

  it("баланс — по пульсу со временем; нет — «Баланс: нет данных» (AC4)", () => {
    expect(closed({ balance: { usd: 30, asOf: "12:40 UTC" } })).toMatch(
      /\nБаланс субсчёта: \$30,00 \(на 12:40 UTC\)\n/,
    );
    expect(closed({ balance: null })).toMatch(/\nБаланс: нет данных\n/);
  });

  it("время в сделке", () => {
    expect(liveHeldText(20_000)).toBe("меньше минуты");
    expect(liveHeldText(45 * 60_000)).toBe("45 мин");
    expect(liveHeldText(3 * 3_600_000)).toBe("3 ч");
    expect(liveHeldText(27 * 3_600_000 + 60_000)).toBe("1 д 3 ч");
  });
});

describe("карточка сделки: проблемы (spec 0068, AC7)", () => {
  it("⚠️ без защиты — что случилось и что сделать своими строками, со звуком", () => {
    const status = {
      kind: "unprotected",
      message: "Стоп не поставлен.",
    } as const;
    expect(liveCardText(s, entry, status)).toBe(
      [
        "⚠️ Без защиты · S98 BTCUSDT long · USDⓈ-M",
        ...entryLines,
        "Что случилось: Стоп не поставлен.",
        "Что сделать: закройте позицию на Binance вручную или нажмите «Закрыть всё».",
        "Вход: 18.10 10:25 UTC",
      ].join("\n"),
    );
    expect(liveCardUrgent(status)).toBe(true);
  });

  it("⚠️ не закрылась — что случилось и что дальше", () => {
    expect(
      liveCardText(s, entry, {
        kind: "close_failed",
        message: "-1021 Timestamp.",
      }).split("\n"),
    ).toEqual([
      "⚠️ Не закрылась · S98 BTCUSDT long · USDⓈ-M",
      ...entryLines,
      "Что случилось: -1021 Timestamp.",
      "Что дальше: закрытие повторяется каждый прогон воркера, пока позиция не закроется.",
      "Вход: 18.10 10:25 UTC",
    ]);
  });

  it("⚪ вход отменён (после ⏳ позиции нет) — что случилось", () => {
    expect(
      liveCardText(s, entry, {
        kind: "cancelled",
        message: "Стоп не встал — позиция закрыта.",
      }),
    ).toMatch(
      /^⚪ Вход отменён · [\s\S]*\nЧто случилось: Стоп не встал — позиция закрыта\.\nВход: /,
    );
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
