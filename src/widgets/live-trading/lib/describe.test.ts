import { describe, expect, it } from "vitest";
import {
  dailyLimitNote,
  haltText,
  keyBlockReason,
  keyBlockShort,
  type LiveModeView,
  liveModeHint,
  liveModeNote,
} from "./describe";

const t = (iso: string) => iso.slice(11, 16);

describe("тексты реального счёта", () => {
  it("«Вкл» недоступно, пока ключ не «✅ годится» — с причиной", () => {
    expect(keyBlockReason({ kind: "ok", warnings: [] }, t)).toBeNull();
    expect(keyBlockReason({ kind: "not-connected" }, t)).toMatch(
      /не подключён/,
    );
    expect(
      keyBlockReason({ kind: "silent", since: "2026-10-16T12:03:00.000Z" }, t),
    ).toMatch(/молчит с 12:03/);
    expect(keyBlockReason({ kind: "blocked", reasons: ["вывод"] }, t)).toMatch(
      /Ключ заблокирован: вывод/,
    );
    expect(keyBlockReason(null, t)).toMatch(/загружается/);
  });

  it("пометка дневного лимита — только когда сработал", () => {
    const day = {
      id: "S98",
      name: "S98",
      market: "usdm",
      dailyPnl: -15.2,
      limitHit: true,
      until: "2026-10-17T00:00:00.000Z",
    };
    expect(dailyLimitNote(day, t)).toBe("−$15,20 за сутки · входы до 00:00");
    expect(dailyLimitNote({ ...day, limitHit: false }, t)).toBeNull();
    expect(dailyLimitNote(undefined, t)).toBeNull();
  });

  it("торговля: вкл или кем и когда остановлены входы", () => {
    const halt = {
      stopped: false,
      stoppedAt: null,
      stoppedBy: null,
      closeAllRequestedAt: null,
      closeAllRequestedBy: null,
      closeAllDoneAt: null,
      closeAllResult: null,
    };
    expect(haltText(halt, t)).toBe("вкл");
    expect(
      haltText(
        {
          ...halt,
          stopped: true,
          stoppedBy: "tester",
          stoppedAt: "2026-10-16T09:15:00.000Z",
        },
        t,
      ),
    ).toBe("входы остановлены (tester, 09:15)");
  });
});

const view = (over: Partial<LiveModeView> = {}): LiveModeView => ({
  mode: "auto",
  liveMirror: false,
  liveThresholds: { lossUsd: 15, streak: 5 },
  liveAuto: null,
  liveAutoOff: null,
  ...over,
});
const snap = (
  decision: NonNullable<LiveModeView["liveAuto"]>["decision"],
  over: Partial<NonNullable<LiveModeView["liveAuto"]>> = {},
) => ({
  checkedAt: "2026-10-17T07:00:00.000Z",
  decision,
  demoTrades: 12,
  demoAvgR: 0.1,
  demoMirror: true,
  pnlUsd: 0,
  lossStreak: 0,
  ...over,
});

describe("режимы реального счёта: подписи (spec 0053, AC1, AC10)", () => {
  it("«Авто»: вкл / ждёт N из 30 / демо-зеркало выкл / демо R < 0", () => {
    expect(liveModeNote(view({ liveMirror: true }), t)).toBe("Авто · вкл");
    expect(liveModeNote(view({ liveAuto: snap("wait") }), t)).toBe(
      "Авто · ждёт: 12 из 30 демо-сделок",
    );
    expect(
      liveModeNote(
        view({ liveAuto: snap("wait", { demoTrades: 0, demoMirror: false }) }),
        t,
      ),
    ).toBe("Авто · ждёт: 0 из 30, демо-зеркало выкл");
    expect(
      liveModeNote(
        view({
          liveAuto: snap("demo_negative", { demoTrades: 34, demoAvgR: -0.2 }),
        }),
        t,
      ),
    ).toBe("Авто · демо R < 0");
    expect(liveModeNote(view(), t)).toBe("Авто · ждёт проверки");
  });

  it("«Выкл» после автовыключения — дата и причина; «Вкл + автовыкл» — пороги; «Вкл» — ничего", () => {
    expect(
      liveModeNote(
        view({
          mode: "off",
          liveAutoOff: {
            at: "2026-10-24T09:15:00.000Z",
            reason: "5 убыточных сделок подряд",
          },
        }),
        t,
      ),
    ).toBe("выключен автоматом 09:15: 5 убыточных сделок подряд");
    expect(liveModeNote(view({ mode: "off" }), t)).toBeNull();
    expect(
      liveModeNote(
        view({
          mode: "on_autooff",
          liveThresholds: { lossUsd: 10, streak: 5 },
        }),
        t,
      ),
    ).toBe("автовыкл: $10 или 5 убыточных сделок подряд");
    expect(liveModeNote(view({ mode: "on", liveMirror: true }), t)).toBeNull();
  });

  it("подсказка при наведении — смысл, пороги и последнее решение", () => {
    const hint = liveModeHint(
      view({ liveAuto: snap("wait", { pnlUsd: -3.2, lossStreak: 2 }) }),
      t,
    );
    expect(hint).toMatch(/^Авто: автомат сам включит/);
    expect(hint).toMatch(/Пороги: \$15 или 5 убыточных сделок подряд/);
    expect(hint).toMatch(
      /Проверка 07:00: Авто · ждёт: 12 из 30 демо-сделок; демо — 12 демо-сделок, средний R \+0,10; реальный PnL −\$3,20, убыточных подряд 2/,
    );
  });
});

describe("короткая причина под переключателем (найдено в 0052)", () => {
  it("не длиннее «ключ заблокирован — включить нельзя»; годный ключ — ничего", () => {
    expect(keyBlockShort({ kind: "ok", warnings: [] })).toBeNull();
    expect(
      keyBlockShort({ kind: "blocked", reasons: ["вывод разрешён", "маржа"] }),
    ).toBe("ключ заблокирован — включить нельзя");
    expect(keyBlockShort({ kind: "not-connected" })).toBe(
      "воркер не подключён — включить нельзя",
    );
    expect(keyBlockShort(null)).toBeNull();
  });
});
