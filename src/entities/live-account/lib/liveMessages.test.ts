import { describe, expect, it } from "vitest";
import { nextUtcMidnight, utcDayStart } from "./liveDay";
import {
  escapeHtml,
  type LiveCardEntry,
  type LiveCardExit,
  type LiveCardStatus,
  liveBinanceUrl,
  liveCardProblem,
  liveCardText,
  liveCardUrgent,
  liveDailyLimitText,
  liveHeldText,
} from "./liveMessages";
import { livePrice } from "./money";

const long = {
  experimentId: "S98",
  symbol: "BTCUSDT",
  market: "usdm" as const,
  direction: "long" as const,
};
const short = { ...long, direction: "short" as const };

// Intl ru-RU разделяет разряды неразрывным пробелом; отступ в лесенке — два en space.
const nb = (text: string) => text.replaceAll(" ", " ");
const G = "  ";

const entry: LiveCardEntry = {
  notionalUsd: 50,
  raised: null,
  entryPrice: 80030,
  stopLoss: 78429.4,
  takeProfit: 83231.2,
  openedAt: "2026-10-18T08:10:31.000Z",
};
const balance = { usd: 512.4, asOf: null };

/** Лесенка long: TP сверху, вход, SL снизу. */
const longLadder = [
  `🟩 ${nb("83 231,2")}${G}+4,0 %`,
  `➡️ ${nb("80 030")}${G}$50,00`,
  `🟥 ${nb("78 429,4")}${G}−2,0 %`,
];

const exit: LiveCardExit = {
  realizedPnl: 0.84,
  closedBy: "tp",
  exitPrice: 83230,
  feesUsd: 0.05,
  closedAt: "2026-10-18T10:25:00.000Z",
  heldMs: (2 * 60 + 15) * 60_000,
};
const closed = (over: Partial<LiveCardExit> = {}): LiveCardStatus => ({
  kind: "closed",
  exit: { ...exit, ...over },
});
const blocks = (text: string) => text.split("\n\n");

describe("карточка сделки, вид — версия 3 (spec 0068)", () => {
  it("🟡 защищена: шапка в две строки, лесенка long, время входа и баланс; без строки статуса; тихо", () => {
    const status = { kind: "protected" } as const;
    expect(liveCardText(long, entry, status, balance)).toBe(
      [
        "🟡 📈 LONG\nBTC/USDT · USDⓈ-M · S98",
        longLadder.join("\n"),
        "➡️ 18.10 · 08:10 UTC\n🏦 Баланс: $512,40",
      ].join("\n\n"),
    );
    expect(liveCardUrgent(status)).toBe(false);
    expect(liveCardProblem(status)).toBe(false);
  });

  it("⏳ вход исполнен — строка статуса, тихо; HTML — монета жирным", () => {
    const status = { kind: "filled" } as const;
    const text = liveCardText(long, entry, status, balance, "html");
    expect(blocks(text).slice(0, 2)).toEqual([
      "⏳ 📈 LONG\n<b>BTC/USDT</b> · USDⓈ-M · S98",
      "⏳ Вход исполнен, ставлю SL/TP…",
    ]);
    expect(liveCardUrgent(status)).toBe(false);
  });

  it("short: SL сверху, TP снизу; % — возможная прибыль (+) и убыток (−)", () => {
    const text = liveCardText(
      short,
      { ...entry, stopLoss: 83231.2, takeProfit: 78429.4 },
      { kind: "protected" },
      balance,
    );
    expect(blocks(text)[0]).toBe("🟡 📉 SHORT\nBTC/USDT · USDⓈ-M · S98");
    expect(blocks(text)[1].split("\n")).toEqual([
      `🟥 ${nb("83 231,2")}${G}−4,0 %`,
      `➡️ ${nb("80 030")}${G}$50,00`,
      `🟩 ${nb("78 429,4")}${G}+2,0 %`,
    ]);
  });

  it("без TP — без строки TP; Spot — пара и рынок; объём поднят — с причиной", () => {
    const text = liveCardText(
      { ...long, market: "spot" },
      { ...entry, takeProfit: null, raised: "minNotional" },
      { kind: "protected" },
      balance,
    );
    expect(blocks(text)[0]).toBe("🟡 📈 LONG\nBTC/USDT · Spot · S98");
    expect(blocks(text)[1].split("\n")).toEqual([
      `➡️ ${nb("80 030")}${G}$50,00 (минимум биржи)`,
      `🟥 ${nb("78 429,4")}${G}−2,0 %`,
    ]);
  });

  it("цены — без хвостов float, 6 значащих цифр (AC2); нет цены входа — без процентов", () => {
    const text = liveCardText(
      { ...long, symbol: "XUSDT" },
      {
        ...entry,
        entryPrice: 81.66221436553849,
        stopLoss: 80.02897007822772,
        takeProfit: null,
      },
      { kind: "protected" },
      balance,
    );
    expect(text).toMatch(/\n➡️ 81,6622  \$50,00\n🟥 80,029  −2,0 %\n/);
    expect(livePrice(0.0000123456789)).toBe("0,0000123457");
    const unknown = liveCardText(
      long,
      { ...entry, entryPrice: null, notionalUsd: null, stopLoss: null },
      { kind: "protected" },
      null,
    );
    expect(unknown).toMatch(/\n➡️ цена входа: нет данных\n🟥 SL нет\n/);
    expect(unknown).not.toMatch(/%/);
    expect(unknown).toMatch(/🏦 Баланс: нет данных$/);
  });

  it("🟢 по TP: PnL в шапке, без строки статуса, 🟩 время закрытия, ⏱, 💸 без пустой строки, со звуком", () => {
    const text = liveCardText(long, entry, closed(), balance);
    expect(blocks(text)).toEqual([
      "🟢 +$0,84 📈 LONG\nBTC/USDT · USDⓈ-M · S98",
      longLadder.join("\n"),
      [
        "➡️ 18.10 · 08:10 UTC",
        "🟩 18.10 · 10:25 UTC",
        "⏱ В сделке: 2 ч 15 мин",
        "💸 Комиссии: $0,05",
        "🏦 Баланс: $512,40",
      ].join("\n"),
    ]);
    expect(liveCardUrgent(closed())).toBe(true);
  });

  it("🔴 по SL (short) — 🟥 время закрытия; баланс из пульса — с временем (AC4)", () => {
    const text = liveCardText(
      short,
      entry,
      closed({ realizedPnl: -1.02, closedBy: "sl", heldMs: 47 * 60_000 }),
      { usd: 511.38, asOf: "12:40 UTC" },
    );
    expect(blocks(text)[0]).toBe("🔴 −$1,02 📉 SHORT\nBTC/USDT · USDⓈ-M · S98");
    expect(blocks(text)[2]).toMatch(
      /^➡️ 18\.10 · 08:10 UTC\n🟥 18\.10 · 10:25 UTC\n⏱ В сделке: 47 мин\n💸 Комиссии: \$0,05\n🏦 Баланс: \$511,38 \(на 12:40 UTC\)$/,
    );
  });

  it("закрыта не по TP/SL — 🏁 время · причина по цене; оценка — строкой статуса и ≈ у PnL и комиссий", () => {
    const text = liveCardText(
      long,
      entry,
      closed({
        realizedPnl: -0.3,
        pnlEstimated: true,
        closedBy: "close_all",
        exitPrice: 79400,
      }),
      balance,
    );
    expect(blocks(text)[0]).toMatch(/^🔴 ≈ −\$0,30 📈 LONG\n/);
    expect(blocks(text)[1]).toBe(
      "≈ PnL — оценка: исполнения Binance не прочитаны",
    );
    expect(text).toMatch(
      new RegExp(
        `\\n🏁 18\\.10 · 10:25 UTC · «Закрыть всё» по ${nb("79 400")}\\n`,
      ),
    );
    expect(text).toMatch(/\n💸 Комиссии: ≈ \$0,05\n/);
    expect(
      liveCardText(long, entry, closed({ closedBy: "mirror" }), balance),
    ).toMatch(/\n🏁 18\.10 · 10:25 UTC · вслед за paper-сделкой по /);
  });

  it("PnL неизвестен — ⚪ PnL ?, пояснение про пороги, остаток и повторы — своими строками", () => {
    const text = liveCardText(
      long,
      entry,
      closed({
        realizedPnl: null,
        closedBy: "mirror",
        exitPrice: null,
        feesUsd: null,
        leftover: { qty: 0.00000986, asset: "BTC", usd: 0.81 },
        attempts: 2,
      }),
      balance,
    );
    expect(blocks(text)[0]).toMatch(/^⚪ PnL \? 📈 LONG\n/);
    expect(blocks(text)[1].split("\n")).toEqual([
      "❔ Цена выхода и исполнения не прочитаны — в порогах автовыключения считается убытком",
      "🪙 Остаток 0.00000986 BTC ≈ $0,81 на субсчёте, в PnL не входит",
      "🔁 Закрыта после 2 попыток",
    ]);
    expect(text).toMatch(/\n🏁 18\.10 · 10:25 UTC · вслед за paper-сделкой\n/);
    expect(text).toMatch(/\n💸 Комиссии: нет данных\n/);
    expect(
      liveCardText(long, entry, closed({ realizedPnl: 0 }), balance),
    ).toMatch(/^⚪ \$0,00 📈 LONG/);
  });

  it("⚠️ без защиты и не закрылась — причина и код API; кнопка «вручную» вместо «Binance»; со звуком", () => {
    const status = {
      kind: "unprotected",
      message: "SL/TP не подтверждены — ордер отклонён (-2010)",
    } as const;
    expect(blocks(liveCardText(long, entry, status, balance))[0]).toBe(
      "⚠️ 📈 LONG\nBTC/USDT · USDⓈ-M · S98",
    );
    expect(blocks(liveCardText(long, entry, status, balance))[1]).toBe(
      "⚠️ Причина: SL/TP не подтверждены — ордер отклонён (-2010)\n🧾 Код API: -2010",
    );
    expect(liveCardUrgent(status)).toBe(true);
    expect(liveCardProblem(status)).toBe(true);
    const failed = {
      kind: "close_failed",
      message: "Binance: Timestamp outside recvWindow. (-1021)",
    } as const;
    expect(blocks(liveCardText(short, entry, failed, balance))[1]).toBe(
      "⚠️ Причина: позиция не закрылась — Binance: Timestamp outside recvWindow. (-1021) Повторяю каждый прогон воркера.\n🧾 Код API: -1021",
    );
    expect(liveCardProblem(failed)).toBe(true);
    // Без кода в тексте — без строки кода.
    expect(
      liveCardText(long, entry, { kind: "unprotected", message: "сеть" }, null),
    ).not.toMatch(/Код API/);
  });

  it("⚪ вход отменён — шапка, строка ↩️, 🏁 время · вход отменён биржей", () => {
    const text = liveCardText(
      long,
      entry,
      {
        kind: "cancelled",
        message: "Биржа отменила вход после исполнения — позиции нет",
        at: "2026-10-18T08:11:00.000Z",
      },
      balance,
    );
    expect(blocks(text)[0]).toBe(
      "⚪ Вход отменён 📈 LONG\nBTC/USDT · USDⓈ-M · S98",
    );
    expect(blocks(text)[1]).toBe(
      "↩️ Биржа отменила вход после исполнения — позиции нет",
    );
    expect(text).toMatch(/\n🏁 18\.10 · 08:11 UTC · вход отменён биржей\n/);
  });

  it("HTML: текст экранирован (&, <, >), простой текст — как есть", () => {
    const status = {
      kind: "unprotected",
      message: "ответ <html> & прочее",
    } as const;
    const html = liveCardText(
      { ...long, experimentId: "S<9>" },
      entry,
      status,
      balance,
      "html",
    );
    expect(html).toMatch(/<b>BTC\/USDT<\/b> · USDⓈ-M · S&lt;9&gt;/);
    expect(html).toMatch(/⚠️ Причина: ответ &lt;html&gt; &amp; прочее/);
    expect(liveCardText(long, entry, status, balance)).toMatch(
      /⚠️ Причина: ответ <html> & прочее/,
    );
    expect(escapeHtml("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });

  it("ссылка на Binance: фьючерс и спот", () => {
    expect(liveBinanceUrl(long)).toBe(
      "https://www.binance.com/en/futures/BTCUSDT",
    );
    expect(liveBinanceUrl({ ...long, market: "spot" })).toBe(
      "https://www.binance.com/en/trade/BTC_USDT",
    );
  });

  it("время в сделке", () => {
    expect(liveHeldText(20_000)).toBe("меньше минуты");
    expect(liveHeldText(45 * 60_000)).toBe("45 мин");
    expect(liveHeldText(3 * 3_600_000)).toBe("3 ч");
    expect(liveHeldText(27 * 3_600_000 + 60_000)).toBe("1 д 3 ч");
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
