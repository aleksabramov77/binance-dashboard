import { describe, expect, it } from "vitest";
import { MIRROR } from "../config/mirror";
import { type MirrorTradeInput, mirrorLevels, planMirror } from "./planMirror";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const trade = (over: Partial<MirrorTradeInput> = {}): MirrorTradeInput => ({
  tradeId: "t1",
  market: "usdm",
  symbol: "ETHUSDT",
  direction: "long",
  openedAt: "2026-10-11T11:59:00Z",
  entryPrice: 100,
  quantity: 0.5,
  stop: 95,
  takeProfit: 110,
  ...over,
});

describe("mirrorLevels", () => {
  it("берёт paper-уровни как есть", () => {
    expect(mirrorLevels(trade())).toEqual({ stopLoss: 95, takeProfit: 110 });
  });

  it("без TP — дальний TP в 10R", () => {
    expect(mirrorLevels(trade({ takeProfit: null }))).toEqual({
      stopLoss: 95,
      takeProfit: 150,
    });
    expect(
      mirrorLevels(trade({ direction: "short", stop: 105, takeProfit: null })),
    ).toEqual({ stopLoss: 105, takeProfit: 50 });
  });

  it("без стопа — страховочный стоп в 50%, TP шорта не уходит в ноль", () => {
    const short = mirrorLevels(
      trade({ direction: "short", stop: null, takeProfit: null }),
    );
    expect(short.stopLoss).toBe(150);
    expect(short.takeProfit).toBe(10);
  });
});

describe("planMirror", () => {
  it("открывает свежую сделку с плечом 1", () => {
    const [d] = planMirror([trade()], [], NOW);
    expect(d).toEqual({
      tradeId: "t1",
      kind: "open",
      request: {
        symbol: "ETHUSDT",
        market: "usdm",
        direction: "long",
        quantity: 0.5,
        leverage: 1,
        fitMinNotional: true,
        stopOnly: false,
        mirror: true,
        stopLoss: 95,
        takeProfit: 110,
      },
    });
  });

  it("пропускает старые входы и не-USDT пары; монета с зеркалом — не пропуск (2d)", () => {
    const decisions = planMirror(
      [
        trade({ tradeId: "old", openedAt: "2026-10-11T11:40:00Z" }),
        trade({ tradeId: "usdc", symbol: "ETHUSDC" }),
        trade({ tradeId: "btc", symbol: "BTCUSDT" }),
        trade({ tradeId: "a" }),
        trade({ tradeId: "b" }),
        trade({ tradeId: "spot", market: "spot" }),
      ],
      [
        {
          market: "usdm",
          symbol: "BTCUSDT",
          direction: "long",
          hasRefs: true,
        },
      ],
      NOW,
    );
    expect(decisions.map((d) => [d.tradeId, d.kind])).toEqual([
      ["old", "skip"],
      ["usdc", "skip"],
      ["btc", "open"],
      ["a", "open"],
      ["b", "open"],
      ["spot", "open"],
    ]);
  });

  it("без TP у paper-сделки — на бирже только стоп", () => {
    const [d] = planMirror([trade({ takeProfit: null })], [], NOW);
    expect(d.kind === "open" && d.request.stopOnly).toBe(true);
  });
});

describe("planMirror: монеты, которых нет на демо (spec 0012, AC2)", () => {
  it("нет на демо-фьючерсах / демо-споте — пропуск с причиной, без входа", () => {
    const d = planMirror(
      [
        trade({ tradeId: "f", symbol: "BTWUSDT" }),
        trade({ tradeId: "s", symbol: "DOSUSDT", market: "spot" }),
        trade({ tradeId: "ok", symbol: "ETHUSDT" }),
      ],
      [],
      NOW,
      {
        missing: new Set(["usdm:BTWUSDT", "spot:DOSUSDT"]),
        unknown: new Set(),
      },
    );
    expect(d).toEqual([
      { tradeId: "f", kind: "skip", reason: "BTWUSDT: нет на демо-фьючерсах." },
      { tradeId: "s", kind: "skip", reason: "DOSUSDT: нет на демо-споте." },
      expect.objectContaining({ tradeId: "ok", kind: "open" }),
    ]);
  });

  it("справочник не загрузился — кандидат ждёт следующего прогона, монету не занимает", () => {
    const d = planMirror(
      [
        trade({ tradeId: "a", symbol: "TRUTHUSDT" }),
        trade({ tradeId: "b", symbol: "TRUTHUSDT" }),
      ],
      [],
      NOW,
      { missing: new Set(), unknown: new Set(["usdm:TRUTHUSDT"]) },
    );
    expect(d).toEqual([]);
  });
});

describe("planMirror: несколько зеркал на монету (spec 0012, PR 2d)", () => {
  const longEth = {
    market: "usdm" as const,
    symbol: "ETHUSDT",
    direction: "long" as const,
    hasRefs: true,
  };

  it("одна сторона — открываем и в One-way (у каждого свой объём и TP/SL)", () => {
    const d = planMirror([trade({ tradeId: "x" })], [longEth], NOW);
    expect(d[0].kind).toBe("open");
  });

  it("встречная сторона: One-way — пропуск с причиной, Hedge — открываем, режим неизвестен — ждём", () => {
    const short = trade({
      tradeId: "s",
      direction: "short",
      stop: 105,
      takeProfit: 90,
    });
    expect(planMirror([short], [longEth], NOW)).toEqual([
      {
        tradeId: "s",
        kind: "skip",
        reason:
          "По ETHUSDT есть встречная позиция другого зеркала — нужен Hedge mode (счёт в One-way).",
      },
    ]);
    expect(
      planMirror([short], [longEth], NOW, undefined, "hedge")[0].kind,
    ).toBe("open");
    expect(planMirror([short], [longEth], NOW, undefined, null)).toEqual([]);
    // Встречные кандидаты одного прогона: первый открыт — второй в One-way пропущен.
    const both = planMirror([trade({ tradeId: "l" }), short], [], NOW);
    expect(both.map((x) => x.kind)).toEqual(["open", "skip"]);
  });

  it("спот: несколько лонгов одной монеты — открываем", () => {
    const d = planMirror(
      [
        trade({ tradeId: "s1", market: "spot" }),
        trade({ tradeId: "s2", market: "spot" }),
      ],
      [{ market: "spot", symbol: "ETHUSDT", direction: "long", hasRefs: true }],
      NOW,
    );
    expect(d.map((x) => x.kind)).toEqual(["open", "open"]);
  });

  it("лимит на монету (MIRROR.maxPerCoin), по умолчанию без лимита", () => {
    expect(MIRROR.maxPerCoin).toBeNull();
    const saved = MIRROR.maxPerCoin;
    MIRROR.maxPerCoin = 2;
    try {
      const d = planMirror(
        [trade({ tradeId: "x" }), trade({ tradeId: "y" })],
        [longEth],
        NOW,
      );
      expect(d.map((x) => x.kind)).toEqual(["open", "skip"]);
      expect(d[1]).toMatchObject({
        reason: "По ETHUSDT (usdm) уже 2 зеркал — лимит на монету 2.",
      });
    } finally {
      MIRROR.maxPerCoin = saved;
    }
  });
});

describe("planMirror: открытые зеркала до PR 2b (без protect_refs)", () => {
  const legacy = {
    market: "usdm" as const,
    symbol: "ETHUSDT",
    direction: "long" as const,
    hasRefs: false,
  };
  it("на монете открыта legacy-строка — любое новое зеркало этого рынка пропускаем", () => {
    const d = planMirror(
      [trade({ tradeId: "x" }), trade({ tradeId: "sp", market: "spot" })],
      [legacy],
      NOW,
      undefined,
      "hedge",
    );
    expect(d).toEqual([
      {
        tradeId: "x",
        kind: "skip",
        reason:
          "По ETHUSDT (usdm) открыто старое зеркало, чьи стоп и тейк закрывают всю позицию, — второе зеркало после его закрытия.",
      },
      // Другой рынок той же монеты — не мешает.
      expect.objectContaining({ tradeId: "sp", kind: "open" }),
    ]);
  });
  it("legacy закрылась — открываем; строки со ссылками — несколько зеркал", () => {
    expect(planMirror([trade({ tradeId: "x" })], [], NOW)[0].kind).toBe("open");
    const d = planMirror(
      [trade({ tradeId: "x" }), trade({ tradeId: "y" })],
      [{ ...legacy, hasRefs: true }],
      NOW,
    );
    expect(d.map((x) => x.kind)).toEqual(["open", "open"]);
  });
});

describe("planMirror: COIN-M (spec 0056)", () => {
  const btc = (over: Partial<MirrorTradeInput> = {}) =>
    trade({
      market: "coinm",
      symbol: "BTCUSD_PERP",
      entryPrice: 81_000,
      quantity: 100 / 81_000,
      stop: 77_000,
      takeProfit: 85_000,
      ...over,
    });

  it("бессрочный …USD_PERP — вход с плечом 1 и ценой paper для контрактов; не …USD_PERP — пропуск", () => {
    const [d] = planMirror([btc()], [], NOW);
    expect(d).toMatchObject({
      kind: "open",
      request: {
        market: "coinm",
        symbol: "BTCUSD_PERP",
        leverage: 1,
        referencePrice: 81_000,
      },
    });
    expect(planMirror([btc({ symbol: "BTCUSD_251226" })], [], NOW)).toEqual([
      {
        tradeId: "t1",
        kind: "skip",
        reason:
          "BTCUSD_251226: демо-зеркало торгует только бессрочные контракты COIN-M (…USD_PERP).",
      },
    ]);
  });

  it("режим позиций свой у рынка: USDⓈ-M в Hedge не открывает встречный COIN-M в One-way", () => {
    const longBtc = {
      market: "coinm" as const,
      symbol: "BTCUSD_PERP",
      direction: "long" as const,
      hasRefs: true,
    };
    const short = btc({
      tradeId: "s",
      direction: "short",
      stop: 85_000,
      takeProfit: 77_000,
    });
    const modes = { usdm: "hedge", coinm: "oneway" } as const;
    expect(planMirror([short], [longBtc], NOW, undefined, modes)[0].kind).toBe(
      "skip",
    );
    expect(
      planMirror([short], [longBtc], NOW, undefined, {
        usdm: "oneway",
        coinm: "hedge",
      })[0].kind,
    ).toBe("open");
    // Лонг USDⓈ-M по BTCUSDT шорту COIN-M по BTCUSD_PERP не встречный: рынки и позиции разные.
    expect(
      planMirror(
        [short],
        [{ ...longBtc, market: "usdm", symbol: "BTCUSDT" }],
        NOW,
        undefined,
        modes,
      )[0].kind,
    ).toBe("open");
  });
});
