import { describe, expect, it } from "vitest";
import type { LiveHeartbeat, LiveState } from "../model/heartbeat";
import { liveHeartbeatSchema } from "../model/heartbeat";
import { deriveLiveStatus, planHeartbeat, planSilence } from "./status";

const T0 = Date.parse("2026-10-16T12:00:00Z");
const MIN = 60_000;
const SILENT = 5 * MIN;

const pulse = (over: Partial<LiveHeartbeat> = {}): LiveHeartbeat => ({
  version: "test",
  sentAt: new Date(T0).toISOString(),
  fixture: null,
  verdict: "ok",
  reasons: [],
  warnings: [],
  restrictions: { flags: null, checkedAt: null },
  uid: null,
  spot: null,
  usdm: null,
  balancesNote: null,
  error: null,
  ...over,
});

const state = (over: Partial<LiveState> = {}): LiveState => ({
  heartbeat: pulse(),
  receivedAt: new Date(T0).toISOString(),
  status: "ok",
  statusSince: new Date(T0).toISOString(),
  silentSince: null,
  ...over,
});

describe("deriveLiveStatus", () => {
  it("пульса не было — «Не подключён»", () => {
    expect(deriveLiveStatus(null, T0, SILENT)).toEqual({
      kind: "not-connected",
    });
  });
  it("пульс старше порога — «молчит с» времени последнего пульса", () => {
    expect(deriveLiveStatus(state(), T0 + SILENT + 1, SILENT)).toEqual({
      kind: "silent",
      since: new Date(T0).toISOString(),
    });
    expect(deriveLiveStatus(state(), T0 + SILENT, SILENT).kind).toBe("ok");
  });
  it("оценка пульса: годится, заблокирован, ключ не задан", () => {
    expect(
      deriveLiveStatus(
        state({ heartbeat: pulse({ warnings: ["фьючерсы недоступны"] }) }),
        T0,
        SILENT,
      ),
    ).toEqual({ kind: "ok", warnings: ["фьючерсы недоступны"] });
    expect(
      deriveLiveStatus(
        state({ heartbeat: pulse({ verdict: "blocked", reasons: ["вывод"] }) }),
        T0,
        SILENT,
      ),
    ).toEqual({ kind: "blocked", reasons: ["вывод"] });
    expect(
      deriveLiveStatus(
        state({ heartbeat: pulse({ verdict: "no-key" }) }),
        T0,
        SILENT,
      ).kind,
    ).toBe("no-key");
  });
});

describe("planHeartbeat", () => {
  it("первый пульс — одна запись и одно сообщение", () => {
    const { next, events } = planHeartbeat(null, pulse(), T0, SILENT);
    expect(next.status).toBe("ok");
    expect(events).toEqual([
      expect.objectContaining({ level: "info", notify: true }),
    ]);
    expect(events[0].message).toMatch(/подключён.*ключ годится/);
  });

  it("та же оценка — без событий и без повторов", () => {
    const prev = state({ statusSince: new Date(T0 - 10 * MIN).toISOString() });
    const { next, events } = planHeartbeat(prev, pulse(), T0 + MIN, SILENT);
    expect(events).toEqual([]);
    expect(next.statusSince).toBe(prev.statusSince);
    expect(next.receivedAt).toBe(new Date(T0 + MIN).toISOString());
  });

  it("годится → заблокирован → годится: по одному сообщению на смену", () => {
    const blocked = pulse({
      verdict: "blocked",
      reasons: ["у ключа разрешён вывод средств"],
    });
    const a = planHeartbeat(state(), blocked, T0 + MIN, SILENT);
    expect(a.events).toEqual([
      expect.objectContaining({ level: "warn", notify: true }),
    ]);
    expect(a.events[0].message).toMatch(/заблокирован: у ключа разрешён вывод/);
    const b = planHeartbeat(a.next, blocked, T0 + 2 * MIN, SILENT);
    expect(b.events).toEqual([]);
    const c = planHeartbeat(b.next, pulse(), T0 + 3 * MIN, SILENT);
    expect(c.events).toEqual([
      expect.objectContaining({ level: "info", notify: true }),
    ]);
  });

  it("пульс после молчания — запись «снова на связи» без Telegram, флаг молчания снят", () => {
    const prev = state({ silentSince: new Date(T0 + 6 * MIN).toISOString() });
    const { next, events } = planHeartbeat(
      prev,
      pulse(),
      T0 + 20 * MIN,
      SILENT,
    );
    expect(next.silentSince).toBeNull();
    expect(events).toEqual([
      {
        level: "info",
        message: "Воркер реального счёта снова на связи: молчал 20 мин",
        notify: false,
      },
    ]);
  });

  it("пульс фикстуры помечается в тексте", () => {
    const { events } = planHeartbeat(
      null,
      pulse({ fixture: "main-account", verdict: "blocked", reasons: ["x"] }),
      T0,
      SILENT,
    );
    expect(events[0].message).toMatch(/фикстура main-account/);
  });
});

describe("planSilence", () => {
  it("молчит дольше порога — одна запись, повторно — ничего", () => {
    const first = planSilence(state(), T0 + 7 * MIN, SILENT);
    expect(first?.event).toEqual({
      level: "warn",
      message: "Воркер реального счёта молчит: последний пульс 7 мин назад",
      notify: false,
    });
    expect(first?.next.silentSince).toBe(new Date(T0 + 7 * MIN).toISOString());
    expect(planSilence(first?.next ?? null, T0 + 30 * MIN, SILENT)).toBeNull();
  });
  it("пульса не было или он свежий — ничего", () => {
    expect(planSilence(null, T0, SILENT)).toBeNull();
    expect(planSilence(state(), T0 + SILENT, SILENT)).toBeNull();
  });
});

describe("liveHeartbeatSchema", () => {
  it("неизвестные поля отбрасываются, ключа в пульсе быть не может", () => {
    const parsed = liveHeartbeatSchema.parse({
      ...pulse(),
      apiKey: "secret",
    });
    expect(parsed).not.toHaveProperty("apiKey");
  });
  it("без обязательного поля пульс не принимается", () => {
    const { verdict: _, ...rest } = pulse();
    expect(liveHeartbeatSchema.safeParse(rest).success).toBe(false);
  });
});
