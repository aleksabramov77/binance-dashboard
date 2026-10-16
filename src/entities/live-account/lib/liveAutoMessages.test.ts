import { describe, expect, it } from "vitest";
import {
  liveAdviceText,
  liveAutoDisableText,
  liveAutoEnableText,
  liveAutoReasonText,
  liveModeText,
} from "./liveAutoMessages";

describe("тексты режимов реального счёта (spec 0053)", () => {
  it("причины автовыключения — как в сценариях spec", () => {
    expect(
      liveAutoReasonText({ kind: "loss", pnlUsd: -10.4, lossUsd: 10 }),
    ).toBe("убыток −$10,40 ≥ порога $10");
    expect(liveAutoReasonText({ kind: "streak", lossStreak: 5 })).toBe(
      "5 убыточных сделок подряд",
    );
    expect(liveAutoReasonText({ kind: "streak", lossStreak: 1 })).toBe(
      "1 убыточная сделка подряд",
    );
    expect(liveAutoReasonText({ kind: "demo", trades: 30, avgR: -0.12 })).toBe(
      "средний R последних 30 демо-сделок −0,12 < 0",
    );
  });

  it("включение «Авто»: числа демо; при стопе входов — пометка (AC7)", () => {
    expect(liveAutoEnableText("S98", { trades: 31, avgR: 0.18 }, null)).toMatch(
      /^🤖 S98 → реальный счёт включён \(Авто\): 31 демо-сделка, средний R \+0,18/,
    );
    expect(
      liveAutoEnableText("S98", { trades: 31, avgR: 0.18 }, "halted"),
    ).toMatch(/входы остановлены — торговли не будет до «Возобновить»/);
  });

  it("выключение и подсказка", () => {
    expect(
      liveAutoDisableText("S98", "auto", "5 убыточных сделок подряд"),
    ).toMatch(
      /^⛔ S98 → реальный счёт выключен \(Авто\): 5 убыточных сделок подряд/,
    );
    expect(liveAdviceText("S96", { kind: "streak", lossStreak: 5 })).toBe(
      "⚠️ S96 — реальный счёт включён вручную: 5 убыточных сделок подряд. Вкл + автовыкл бы выключил",
    );
    expect(
      liveAdviceText("S96", { kind: "loss", pnlUsd: -16.2, lossUsd: 15 }),
    ).toMatch(/убыток −\$16,20 с момента включения \(порог \$15\)/);
  });

  it("ручное переключение — с порогами для режимов с автоматом", () => {
    expect(
      liveModeText("S97", "on_autooff", "tester", { lossUsd: 10, streak: 5 }),
    ).toMatch(/выключится сам — порог \$10 или 5 убыточных сделок подряд/);
    expect(
      liveModeText("S97", "off", "tester", { lossUsd: 15, streak: 5 }),
    ).toMatch(/^💤/);
  });
});
