import type { MirrorMarket } from "./planMirror";

// Записи журнала об отказах и пропусках зеркала (spec 0016): по одной на сделку, с experimentId —
// страница /logs фильтрует по ним по ссылке из «N отказ · M пропуск». Пишет композиция src/app/server/demoMirror.ts.

export interface MirrorLogSubject {
  tradeId: string;
  experimentId: string;
  symbol: string;
  market: MirrorMarket;
}

export function mirrorLogEntry(
  kind: "rejected" | "skipped",
  c: MirrorLogSubject,
  reason: string,
) {
  const rejected = kind === "rejected";
  return {
    level: rejected ? ("warn" as const) : ("info" as const),
    event: rejected
      ? ("mirror.rejected" as const)
      : ("mirror.skipped" as const),
    message: `${c.experimentId} ${c.symbol}: ${rejected ? "отказ" : "пропуск"} — ${reason}`,
    data: {
      experimentId: c.experimentId,
      tradeId: c.tradeId,
      symbol: c.symbol,
      market: c.market,
      reason,
    },
  };
}
