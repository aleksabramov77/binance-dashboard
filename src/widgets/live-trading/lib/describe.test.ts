import { describe, expect, it } from "vitest";
import { dailyLimitNote, haltText, keyBlockReason } from "./describe";

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
