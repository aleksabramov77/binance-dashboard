import { describe, expect, it } from "vitest";
import {
  computeLiveStats,
  emptyLiveSummary,
  type LiveStatsRow,
} from "./liveStats";

const closed = (
  closedAt: string,
  realizedPnl: number | null,
  pnlEstimated = false,
): LiveStatsRow => ({ status: "closed", realizedPnl, pnlEstimated, closedAt });
const row = (status: LiveStatsRow["status"]): LiveStatsRow => ({
  status,
  realizedPnl: null,
  pnlEstimated: false,
  closedAt: null,
});

describe("computeLiveStats", () => {
  it("нет строк — пустая сводка: нули и null, где делить не на что", () => {
    expect(computeLiveStats([])).toEqual(emptyLiveSummary());
    expect(emptyLiveSummary()).toMatchObject({
      trades: 0,
      winRate: null,
      profitFactor: null,
      pnl: 0,
      maxDrawdown: 0,
    });
  });

  it("9 закрытых и 1 открытая: win rate, PnL, PF, просадка и equity в $ в порядке закрытия", () => {
    const pnls = [0.5, -0.4, 0.8, -0.9, 0.6, -0.8, 1.2, 0.7, 0.14];
    const rows = [
      ...pnls.map((p, i) =>
        closed(`2026-10-1${i < 5 ? 1 : 2}T0${i}:00:00Z`, p),
      ),
      row("protected"),
    ];
    const s = computeLiveStats(rows);
    expect(s).toMatchObject({
      trades: 10,
      closed: 9,
      open: 1,
      wins: 6,
      losses: 3,
      estimated: 0,
      unknown: 0,
    });
    expect(s.winRate).toBeCloseTo(6 / 9);
    expect(s.pnl).toBeCloseTo(1.84);
    expect(s.grossProfit).toBeCloseTo(3.94);
    expect(s.profitFactor).toBeCloseTo(3.94 / 2.1);
    // Накопленный PnL: 0,5 → 0,1 → 0,9 → 0 → 0,6 → −0,2 …: пик 0,9, дно −0,2.
    expect(s.maxDrawdown).toBeCloseTo(1.1);
  });

  it("порядок — по времени закрытия, а не по порядку строк", () => {
    const s = computeLiveStats([
      closed("2026-10-12T03:00:00Z", -3),
      closed("2026-10-12T01:00:00Z", 5),
      closed("2026-10-12T02:00:00Z", -1),
    ]);
    // 5 → 4 → 1: просадка от пика 5 — $4.
    expect(s.maxDrawdown).toBe(4);
    expect(s.pnl).toBe(1);
  });

  it("первый же убыток — просадка от нуля", () => {
    expect(
      computeLiveStats([
        closed("2026-10-12T01:00:00Z", -2.1),
        closed("2026-10-12T02:00:00Z", 1),
      ]).maxDrawdown,
    ).toBeCloseTo(2.1);
  });

  it("без убытков — PF null (∞ в таблице), просадки нет", () => {
    const s = computeLiveStats([
      closed("2026-10-12T01:00:00Z", 1),
      closed("2026-10-12T02:00:00Z", 2),
    ]);
    expect(s.profitFactor).toBeNull();
    expect(s.grossProfit).toBe(3);
    expect(s.maxDrawdown).toBe(0);
  });

  it("оценки входят в PnL и считаются отдельно", () => {
    const s = computeLiveStats([
      closed("2026-10-12T01:00:00Z", 1, true),
      closed("2026-10-12T02:00:00Z", -0.5),
      closed("2026-10-12T03:00:00Z", 0.2, true),
    ]);
    expect(s.estimated).toBe(2);
    expect(s.pnl).toBeCloseTo(0.7);
  });

  it("закрытая без PnL — в закрытых, но не в PnL, win rate и просадке", () => {
    const s = computeLiveStats([
      closed("2026-10-12T01:00:00Z", 1),
      closed("2026-10-12T02:00:00Z", null),
      closed("2026-10-12T03:00:00Z", -0.4),
    ]);
    expect(s).toMatchObject({ closed: 3, unknown: 1, wins: 1, losses: 1 });
    expect(s.winRate).toBe(0.5);
    expect(s.pnl).toBeCloseTo(0.6);
    expect(s.maxDrawdown).toBeCloseTo(0.4);
  });

  it("только закрытые без PnL — win rate null", () => {
    expect(
      computeLiveStats([closed("2026-10-12T01:00:00Z", null)]).winRate,
    ).toBeNull();
  });

  it("отказы и пропуски — только счётчики; всё, что не закрыто, — открытые", () => {
    const s = computeLiveStats([
      row("rejected"),
      row("skipped"),
      row("skipped"),
      row("pending"),
      row("unprotected"),
      row("closing"),
      row("close_failed"),
    ]);
    expect(s).toMatchObject({
      rejected: 1,
      skipped: 2,
      trades: 4,
      open: 4,
      closed: 0,
      winRate: null,
      pnl: 0,
    });
  });
});
