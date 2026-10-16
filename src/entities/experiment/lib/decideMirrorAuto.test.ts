import { describe, expect, it } from "vitest";
import { mirrorAutoSnapshotSchema } from "../model/mirrorAuto";
import {
  decideMirrorAuto,
  type MirrorAutoInput,
  mirrorWindowR,
  mirrorWindowStart,
  nextMirrorAutoSnapshot,
} from "./decideMirrorAuto";
import { mirrorAdviceMessage, mirrorChangeMessage } from "./mirrorAutoMessages";

const exp = (over: Partial<MirrorAutoInput> = {}): MirrorAutoInput => ({
  id: "S98",
  market: "spot",
  enabled: true,
  demoMirror: false,
  mode: "auto",
  advice: null,
  windowR: [],
  ...over,
});

/** n сделок с одинаковым R. */
const rs = (n: number, r: number) => Array.from({ length: n }, () => r);

describe("decideMirrorAuto: «Авто»", () => {
  it("выкл, эксперимент включён, ≥ 30 сделок со средним R > 0 — включить", () => {
    const plan = decideMirrorAuto(
      exp({ windowR: [...rs(30, 0.3), ...rs(4, -0.3)] }),
      true,
    );
    expect(plan?.change).toBe(true);
    expect(plan?.verdict).toMatchObject({ decision: "enable", trades: 34 });
    expect(plan?.verdict.avgR).toBeCloseTo((30 * 0.3 - 4 * 0.3) / 34);
  });

  it("выкл: меньше 30 сделок, средний R ≤ 0 или эксперимент выключен — не включать", () => {
    for (const e of [
      exp({ windowR: rs(29, 1) }),
      exp({ windowR: rs(40, 0) }),
      exp({ windowR: rs(40, -0.1) }),
      exp({ windowR: rs(40, 1), enabled: false }),
    ]) {
      const plan = decideMirrorAuto(e, true);
      expect(plan?.change).toBeNull();
      expect(plan?.verdict.decision).toBe("keep");
    }
  });

  it("вкл, эксперимент выключен — выключить при любых сделках (правило 2)", () => {
    const plan = decideMirrorAuto(
      exp({ demoMirror: true, enabled: false, windowR: rs(40, 2) }),
      true,
    );
    expect(plan?.change).toBe(false);
    expect(plan?.verdict.decision).toBe("disable_off");
  });

  it("вкл, ≥ 30 сделок, средний R последних 30 < 0 — выключить (правило 3)", () => {
    const plan = decideMirrorAuto(
      exp({ demoMirror: true, windowR: rs(30, -0.12) }),
      true,
    );
    expect(plan?.change).toBe(false);
    expect(plan?.verdict).toMatchObject({
      decision: "disable_loss",
      trades: 30,
    });
    expect(plan?.verdict.avgR).toBeCloseTo(-0.12);
  });

  it("вкл: скользящее окно последних 30 — поздний обвал снимает зеркало, ранний плюс не спасает", () => {
    const plan = decideMirrorAuto(
      exp({ demoMirror: true, windowR: [...rs(20, 3), ...rs(30, -0.5)] }),
      true,
    );
    expect(plan?.verdict).toMatchObject({
      decision: "disable_loss",
      trades: 30,
    });
  });

  it("вкл: меньше 30 сделок или средний R последних 30 ≥ 0 — оставить", () => {
    for (const windowR of [
      rs(29, -1),
      rs(30, 0),
      [...rs(10, -5), ...rs(30, 0.1)],
    ])
      expect(
        decideMirrorAuto(exp({ demoMirror: true, windowR }), true)?.change,
      ).toBeNull();
  });

  it("без ключа Binance Demo ничего не включает, но выключать может", () => {
    const on = decideMirrorAuto(exp({ windowR: rs(30, 1) }), false);
    expect(on?.change).toBeNull();
    expect(on?.verdict.decision).toBe("no_key");
    const off = decideMirrorAuto(
      exp({ demoMirror: true, enabled: false }),
      false,
    );
    expect(off?.change).toBe(false);
  });

  it("COIN-M автомат не трогает", () => {
    expect(
      decideMirrorAuto(exp({ market: "coinm", windowR: rs(30, 1) }), true),
    ).toBeNull();
  });

  it("в «Авто» подсказок нет, старая подсказка сбрасывается", () => {
    const plan = decideMirrorAuto(
      exp({ advice: "on", windowR: rs(30, 1) }),
      true,
    );
    expect(plan?.sendAdvice).toBeNull();
    expect(plan?.adviceState).toBeNull();
  });
});

describe("decideMirrorAuto: ручные положения (AC4)", () => {
  it("«Вкл» вручную автомат не выключает ни при каких числах — только подсказка", () => {
    for (const e of [
      exp({ mode: "on", demoMirror: true, windowR: rs(30, -2) }),
      exp({ mode: "on", demoMirror: true, enabled: false }),
    ]) {
      const plan = decideMirrorAuto(e, true);
      expect(plan?.change).toBeNull();
      expect(plan?.sendAdvice).toBe("off");
      expect(plan?.adviceState).toBe("off");
    }
  });

  it("«Выкл» вручную автомат не включает ни при каких числах — только подсказка", () => {
    const plan = decideMirrorAuto(
      exp({ mode: "off", windowR: rs(34, 0.21) }),
      true,
    );
    expect(plan?.change).toBeNull();
    expect(plan?.sendAdvice).toBe("on");
    expect(plan?.adviceState).toBe("on");
  });

  it("условие не держится — подсказки нет", () => {
    const plan = decideMirrorAuto(
      exp({ mode: "off", windowR: rs(34, -0.21) }),
      true,
    );
    expect(plan?.sendAdvice).toBeNull();
    expect(plan?.adviceState).toBeUndefined();
  });

  it("без ключа Binance Demo подсказки «включить» нет", () => {
    expect(
      decideMirrorAuto(exp({ mode: "off", windowR: rs(34, 1) }), false)
        ?.sendAdvice,
    ).toBeNull();
  });
});

describe("подсказки: без повторов, пока условие держится", () => {
  it("одна подсказка на появление условия; ушло — сброс; вернулось — снова", () => {
    const losing = exp({ mode: "on", demoMirror: true, windowR: rs(30, -1) });
    const first = decideMirrorAuto(losing, true);
    expect(first?.sendAdvice).toBe("off");

    // Подсказка сохранена — пока условие держится, повтора нет и запись не меняется.
    const held = decideMirrorAuto({ ...losing, advice: "off" }, true);
    expect(held?.sendAdvice).toBeNull();
    expect(held?.adviceState).toBeUndefined();

    // Условие ушло — подсказка сбрасывается без сообщения.
    const gone = decideMirrorAuto(
      { ...losing, advice: "off", windowR: rs(30, 1) },
      true,
    );
    expect(gone?.sendAdvice).toBeNull();
    expect(gone?.adviceState).toBeNull();

    // Вернулось — подсказка может прийти снова.
    expect(
      decideMirrorAuto({ ...losing, advice: null }, true)?.sendAdvice,
    ).toBe("off");
  });
});

describe("окно сделок", () => {
  const at = (iso: string) => new Date(iso);
  it("начало — самый поздний из старта эпохи, сброса paper-капитала и изменения зеркала", () => {
    expect(
      mirrorWindowStart(
        at("2026-10-01T00:00:00Z"),
        null,
        at("2026-10-10T00:00:00Z"),
      ),
    ).toBe(Date.parse("2026-10-10T00:00:00Z"));
    expect(
      mirrorWindowStart(
        at("2026-10-01T00:00:00Z"),
        at("2026-10-12T00:00:00Z"),
        at("2026-10-10T00:00:00Z"),
      ),
    ).toBe(Date.parse("2026-10-12T00:00:00Z"));
    expect(mirrorWindowStart(at("2026-10-01T00:00:00Z"), null, null)).toBe(
      Date.parse("2026-10-01T00:00:00Z"),
    );
  });

  it("AC6: после автовыключения старые прибыльные сделки эпохи не включают снова — только ≥ 30 новых с R > 0", () => {
    const off = at("2026-10-10T00:00:00Z");
    const day = (d: number) =>
      new Date(Date.parse("2026-10-01T00:00:00Z") + d * 3_600_000);
    // 40 прибыльных сделок до выключения, после — 29 новых прибыльных.
    const old = Array.from({ length: 40 }, (_, i) => ({
      openedAt: day(i),
      rMultiple: 1,
    }));
    const fresh = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        openedAt: new Date(off.getTime() + (i + 1) * 3_600_000),
        rMultiple: 0.5,
      }));
    const start = mirrorWindowStart(at("2026-10-01T00:00:00Z"), null, off);
    const input = (n: number) =>
      exp({ windowR: mirrorWindowR([...old, ...fresh(n)], start) });
    expect(decideMirrorAuto(input(29), true)?.change).toBeNull();
    expect(decideMirrorAuto(input(30), true)?.change).toBe(true);
  });
});

describe("тексты", () => {
  it("изменения зеркала — как в spec", () => {
    const enable = decideMirrorAuto(
      exp({ windowR: [...rs(17, 0.42), ...rs(17, 0)] }),
      true,
    );
    expect(enable && mirrorChangeMessage(enable)).toBe(
      "S98 → демо-зеркало включено: 34 сделки, средний R +0.21",
    );
    const loss = decideMirrorAuto(
      exp({ demoMirror: true, windowR: rs(30, -0.12) }),
      true,
    );
    expect(loss && mirrorChangeMessage(loss)).toBe(
      "S98 → демо-зеркало выключено: 30 сделок после включения, средний R −0.12",
    );
    const off = decideMirrorAuto(
      exp({ demoMirror: true, enabled: false }),
      true,
    );
    expect(off && mirrorChangeMessage(off)).toBe(
      "S98 → демо-зеркало выключено: эксперимент выключен",
    );
  });

  it("подсказки — как в spec", () => {
    const loss = decideMirrorAuto(
      exp({ mode: "on", demoMirror: true, windowR: rs(30, -0.12) }),
      true,
    );
    expect(loss && mirrorAdviceMessage(loss)).toBe(
      "⚠️ S98 — демо-зеркало включено вручную, но похоже убыточно: 30 сделок, средний R −0.12. Авто бы выключил",
    );
    const under = decideMirrorAuto(
      exp({ mode: "off", windowR: [...rs(17, 0.42), ...rs(17, 0)] }),
      true,
    );
    expect(under && mirrorAdviceMessage(under)).toBe(
      "💡 S98 — демо-зеркало выключено вручную, а похоже недооценено: 34 сделки, средний R +0.21. Авто бы включил",
    );
  });
});

describe("снимок авто-зеркала для подсказки в UI", () => {
  const enable = {
    decision: "enable" as const,
    trades: 32,
    avgR: 0.2,
  };
  const keep = { decision: "keep" as const, trades: 0, avgR: null };

  it("изменение запоминается; следующая проверка «оставил» его не затирает", () => {
    const first = nextMirrorAutoSnapshot(null, enable, true, true, "d1");
    expect(first).toEqual({
      checkedAt: "d1",
      check: { ...enable, demoMirror: true },
      change: { at: "d1", ...enable, demoMirror: true },
    });
    const next = nextMirrorAutoSnapshot(first, keep, true, false, "d2");
    expect(next).toEqual({
      checkedAt: "d2",
      check: { ...keep, demoMirror: true },
      change: { at: "d1", ...enable, demoMirror: true },
    });
  });

  it("без изменений с самого начала — change null", () => {
    expect(
      nextMirrorAutoSnapshot(null, keep, false, false, "d1").change,
    ).toBeNull();
  });

  it("снимок первой версии читается: решение-изменение становится последним изменением", () => {
    const legacy = {
      at: "d1",
      decision: "enable",
      demoMirror: true,
      trades: 32,
      avgR: 0.2,
    };
    expect(mirrorAutoSnapshotSchema.parse(legacy)).toEqual({
      checkedAt: "d1",
      check: { decision: "enable", demoMirror: true, trades: 32, avgR: 0.2 },
      change: {
        at: "d1",
        decision: "enable",
        demoMirror: true,
        trades: 32,
        avgR: 0.2,
      },
    });
    expect(
      mirrorAutoSnapshotSchema.parse({ ...legacy, decision: "keep" }).change,
    ).toBeNull();
  });
});
