import { describe, expect, it } from "vitest";
import { DEFAULT_LIVE_THRESHOLDS } from "../model/liveAuto";
import {
  demoTradeR,
  type LiveAutoInput,
  type LiveClosedTrade,
  liveDemoVerdict,
  liveThresholdVerdict,
  planLiveAuto,
  stopLossPnl,
} from "./liveAuto";

const win = (pnl: number): LiveClosedTrade => ({
  realizedPnl: pnl,
  stopPnl: null,
});
const times = <T>(n: number, x: T) => Array.from({ length: n }, () => x);

describe("demoTradeR: R демо-сделки (AC5)", () => {
  it("long и short: (выход − вход демо) × знак ÷ |вход − исходный стоп paper|", () => {
    expect(
      demoTradeR({
        direction: "long",
        demoEntry: 101,
        exit: 111,
        paperEntry: 100,
        initialStop: 95,
      }),
    ).toBeCloseTo(2);
    expect(
      demoTradeR({
        direction: "short",
        demoEntry: 100,
        exit: 105,
        paperEntry: 100,
        initialStop: 110,
      }),
    ).toBeCloseTo(-0.5);
  });
  it("без цены выхода, входа или стопа (или нулевой риск) — не считается", () => {
    const t = {
      direction: "long" as const,
      demoEntry: 100,
      exit: 110,
      paperEntry: 100,
      initialStop: 95,
    };
    expect(demoTradeR({ ...t, exit: null })).toBeNull();
    expect(demoTradeR({ ...t, demoEntry: null })).toBeNull();
    expect(demoTradeR({ ...t, initialStop: null })).toBeNull();
    expect(demoTradeR({ ...t, initialStop: 100 })).toBeNull();
  });
});

describe("stopLossPnl", () => {
  it("убыток по своему стопу; чего-то нет — null", () => {
    expect(
      stopLossPnl({
        direction: "long",
        entryPrice: 100,
        stopLoss: 95,
        quantity: 0.1,
      }),
    ).toBeCloseTo(-0.5);
    expect(
      stopLossPnl({
        direction: "short",
        entryPrice: 100,
        stopLoss: 104,
        quantity: 1,
      }),
    ).toBeCloseTo(-4);
    expect(
      stopLossPnl({
        direction: "long",
        entryPrice: 100,
        stopLoss: null,
        quantity: 1,
      }),
    ).toBeNull();
  });
});

describe("liveThresholdVerdict: пороги (AC3)", () => {
  const t = { lossUsd: 10, streak: 5 };
  it("сумма с момента включения ≤ −порога → loss (сценарий 4: −$10,40 при пороге $10)", () => {
    const v = liveThresholdVerdict([win(-6), win(1), win(-5.4)], t);
    expect(v).toMatchObject({ pnlUsd: -10.4, trip: "loss", lossStreak: 1 });
  });
  it("ровно −порог — уже выключает; −$9,99 — нет", () => {
    expect(liveThresholdVerdict([win(-10)], t).trip).toBe("loss");
    expect(liveThresholdVerdict([win(-9.99)], t).trip).toBeNull();
  });
  it("N убыточных подряд с конца → streak; прибыль или 0 серию обрывают", () => {
    expect(liveThresholdVerdict(times(5, win(-0.1)), t)).toMatchObject({
      lossStreak: 5,
      trip: "streak",
    });
    expect(
      liveThresholdVerdict([...times(4, win(-0.1)), win(0), win(-0.1)], t),
    ).toMatchObject({ lossStreak: 1, trip: null });
  });
  it("убыток и серия сразу — причина «убыток» (важнее)", () => {
    expect(liveThresholdVerdict(times(5, win(-3)), t).trip).toBe("loss");
  });
  it("PnL неизвестен: в серии — убыток, в сумме — по своему стопу, иначе 0", () => {
    const v = liveThresholdVerdict(
      [
        { realizedPnl: null, stopPnl: -0.5 },
        { realizedPnl: null, stopPnl: null },
        win(-0.2),
      ],
      { lossUsd: 15, streak: 3 },
    );
    expect(v).toMatchObject({
      pnlUsd: -0.7,
      lossStreak: 3,
      unknown: 2,
      trip: "streak",
    });
  });
  it("сделок нет — ничего не сработало", () => {
    expect(liveThresholdVerdict([], DEFAULT_LIVE_THRESHOLDS)).toEqual({
      trades: 0,
      pnlUsd: 0,
      lossStreak: 0,
      unknown: 0,
      trip: null,
    });
  });
});

describe("liveDemoVerdict: «Авто» по демо (AC4)", () => {
  const r = (n: number, v: number) => times(n, v);
  it("выключен: < 30 демо-сделок — ждёт (N из 30)", () => {
    expect(
      liveDemoVerdict({
        enabled: true,
        liveOn: false,
        windowR: r(12, 1),
        recentR: r(12, 1),
      }),
    ).toEqual({ decision: "wait", trades: 12, avgR: 1 });
    expect(
      liveDemoVerdict({
        enabled: true,
        liveOn: false,
        windowR: [],
        recentR: [],
      }),
    ).toEqual({ decision: "wait", trades: 0, avgR: null });
  });
  it("выключен: ≥ 30 со средним R > 0 — включить; ≤ 0 — демо R не выше 0", () => {
    expect(
      liveDemoVerdict({
        enabled: true,
        liveOn: false,
        windowR: [...r(16, 1), ...r(15, -0.8)],
        recentR: [],
      }),
    ).toMatchObject({ decision: "enable", trades: 31 });
    expect(
      liveDemoVerdict({
        enabled: true,
        liveOn: false,
        windowR: r(30, 0),
        recentR: [],
      }).decision,
    ).toBe("demo_negative");
  });
  it("выключен, эксперимент выключен — не включать", () => {
    expect(
      liveDemoVerdict({
        enabled: false,
        liveOn: false,
        windowR: r(40, 1),
        recentR: [],
      }).decision,
    ).toBe("paper_off");
  });
  it("включён: средний R последних 30 < 0 — выключить; ранние прибыльные не спасают", () => {
    expect(
      liveDemoVerdict({
        enabled: true,
        liveOn: true,
        windowR: [],
        recentR: [...r(20, 5), ...r(30, -0.1)],
      }),
    ).toMatchObject({ decision: "disable_demo", trades: 30 });
  });
  it("включён: < 30 демо-сделок или средний R ≥ 0 — оставить", () => {
    expect(
      liveDemoVerdict({
        enabled: true,
        liveOn: true,
        windowR: [],
        recentR: r(29, -1),
      }).decision,
    ).toBe("keep");
    expect(
      liveDemoVerdict({
        enabled: true,
        liveOn: true,
        windowR: [],
        recentR: r(30, 0),
      }).decision,
    ).toBe("keep");
  });
});

const input = (over: Partial<LiveAutoInput> = {}): LiveAutoInput => ({
  mode: "auto",
  liveOn: true,
  enabled: true,
  advice: null,
  thresholds: DEFAULT_LIVE_THRESHOLDS,
  closed: [],
  demo: null,
  ...over,
});
const fiveLosses = times(5, win(-0.3));

describe("planLiveAuto: план по эксперименту", () => {
  it("«Выкл» (в том числе после автовыключения) — автомат не трогает", () => {
    expect(
      planLiveAuto(
        input({
          mode: "off",
          liveOn: false,
          closed: fiveLosses,
          demo: { windowR: times(40, 1), recentR: times(40, 1) },
        }),
      ),
    ).toBeNull();
  });

  it("ручное «Вкл» не меняется никогда: порог — только подсказка, одна, без повторов", () => {
    const p = planLiveAuto(input({ mode: "on", closed: fiveLosses }));
    expect(p).toMatchObject({
      change: null,
      sendAdvice: "streak",
      adviceState: "streak",
    });
    const again = planLiveAuto(
      input({ mode: "on", closed: fiveLosses, advice: "streak" }),
    );
    expect(again).toMatchObject({
      change: null,
      sendAdvice: null,
      adviceState: undefined,
    });
    // Другой порог — новая подсказка; условие ушло — подсказка сбрасывается.
    expect(
      planLiveAuto(input({ mode: "on", closed: [win(-20)], advice: "streak" })),
    ).toMatchObject({ sendAdvice: "loss", adviceState: "loss" });
    expect(
      planLiveAuto(input({ mode: "on", closed: [win(1)], advice: "streak" })),
    ).toMatchObject({ sendAdvice: null, adviceState: null });
    // Демо у ручного «Вкл» не применяется.
    expect(
      planLiveAuto(
        input({ mode: "on", demo: { windowR: [], recentR: times(30, -1) } }),
      ),
    ).toMatchObject({ change: null, demo: null });
  });

  it("«Вкл + автовыкл»: порог → выключить; держится — оставить; демо не смотрит", () => {
    expect(
      planLiveAuto(input({ mode: "on_autooff", closed: fiveLosses })),
    ).toMatchObject({ change: "disable", decision: "disable_streak" });
    expect(
      planLiveAuto(input({ mode: "on_autooff", closed: [win(-20)] })),
    ).toMatchObject({ change: "disable", decision: "disable_loss" });
    expect(
      planLiveAuto(
        input({
          mode: "on_autooff",
          closed: [win(-1)],
          demo: { windowR: [], recentR: times(30, -1) },
        }),
      ),
    ).toMatchObject({ change: null, decision: "keep" });
  });

  it("«Авто» включён: порог раньше демо; демо R < 0 — выключить; иначе оставить", () => {
    expect(
      planLiveAuto(
        input({
          closed: fiveLosses,
          demo: { windowR: [], recentR: times(30, 1) },
        }),
      ),
    ).toMatchObject({ change: "disable", decision: "disable_streak" });
    expect(
      planLiveAuto(input({ demo: { windowR: [], recentR: times(30, -0.1) } })),
    ).toMatchObject({ change: "disable", decision: "disable_demo" });
    expect(
      planLiveAuto(input({ demo: { windowR: [], recentR: times(30, 0.1) } })),
    ).toMatchObject({ change: null, decision: "keep" });
    // Сохранение закрытия: демо-данных нет — только пороги.
    expect(planLiveAuto(input({ closed: [win(-1)] }))).toMatchObject({
      change: null,
      decision: "keep",
      demo: null,
    });
  });

  it("«Авто» выключен: по демо — включить, ждать или демо R не выше 0", () => {
    const off = { liveOn: false };
    expect(
      planLiveAuto(
        input({ ...off, demo: { windowR: times(31, 0.18), recentR: [] } }),
      ),
    ).toMatchObject({ change: "enable", decision: "enable" });
    expect(
      planLiveAuto(
        input({ ...off, demo: { windowR: times(12, 1), recentR: [] } }),
      ),
    ).toMatchObject({ change: null, decision: "wait", demo: { trades: 12 } });
    expect(
      planLiveAuto(
        input({ ...off, demo: { windowR: times(30, -0.2), recentR: [] } }),
      ),
    ).toMatchObject({ change: null, decision: "demo_negative" });
  });

  it("режим с автоматом сбрасывает прежнюю подсказку ручного «Вкл»", () => {
    expect(planLiveAuto(input({ advice: "loss" }))?.adviceState).toBeNull();
    expect(planLiveAuto(input())?.adviceState).toBeUndefined();
  });
});
