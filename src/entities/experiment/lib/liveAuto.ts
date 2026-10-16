import { LIVE_AUTO } from "../config/liveAuto";
import type {
  LiveAutoDecision,
  LiveMirrorMode,
  LiveThresholds,
  LiveTrip,
} from "../model/liveAuto";

// Режимы реального счёта (spec 0053) — чистые функции: R демо-сделки, пороги автовыключения, правило «Авто» по демо
// и план по эксперименту. Без БД, биржи и времени — их передают композиции src/app/server/liveAuto.ts и
// liveMirror.ts (сохранение закрытия).

/**
 * R демо-сделки (AC5): (выход − вход демо) × знак ÷ |вход − исходный стоп| paper-сделки того же trade_id. null — нет цены
 * выхода, входа или стопа (сделка не считается).
 */
export function demoTradeR(t: {
  direction: "long" | "short";
  demoEntry: number | null;
  exit: number | null;
  paperEntry: number;
  initialStop: number | null;
}): number | null {
  if (t.demoEntry === null || t.exit === null || t.initialStop === null)
    return null;
  const risk = Math.abs(t.paperEntry - t.initialStop);
  if (!(risk > 0)) return null;
  const sign = t.direction === "short" ? -1 : 1;
  return ((t.exit - t.demoEntry) * sign) / risk;
}

/** PnL сделки по цене своего стопа — худший случай для строки «PnL неизвестен»; null — чего-то не знаем. */
export function stopLossPnl(r: {
  direction: "long" | "short";
  entryPrice: number | null;
  stopLoss: number | null;
  quantity: number | null;
}): number | null {
  if (r.entryPrice === null || r.stopLoss === null || r.quantity === null)
    return null;
  const sign = r.direction === "short" ? -1 : 1;
  return (r.stopLoss - r.entryPrice) * sign * r.quantity;
}

/** Закрытая реальная сделка эксперимента после включения — в порядке закрытия. */
export interface LiveClosedTrade {
  /** null — PnL неизвестен (исполнения и цена не прочитаны). */
  realizedPnl: number | null;
  /** PnL по своему стопу (stopLossPnl) — для суммы, когда realizedPnl неизвестен. */
  stopPnl: number | null;
}

export interface LiveThresholdVerdict {
  trades: number;
  /** Реализованный PnL с момента включения, $ (неизвестные — по своему стопу, иначе 0). */
  pnlUsd: number;
  /** Убыточных подряд с конца (неизвестный PnL — убыток). */
  lossStreak: number;
  /** Сколько сделок с неизвестным PnL. */
  unknown: number;
  /** Сработавший порог; null — оба держатся. Убыток в $ важнее серии. */
  trip: LiveTrip | null;
}

const cents = (v: number) => Math.round(v * 100) / 100;

/** Пороги автовыключения (AC3) по закрытым сделкам с момента включения. */
export function liveThresholdVerdict(
  trades: readonly LiveClosedTrade[],
  t: LiveThresholds,
): LiveThresholdVerdict {
  let pnl = 0;
  let unknown = 0;
  for (const r of trades) {
    if (r.realizedPnl === null) {
      unknown++;
      pnl += r.stopPnl ?? 0;
    } else pnl += r.realizedPnl;
  }
  let lossStreak = 0;
  for (let i = trades.length - 1; i >= 0; i--) {
    const p = trades[i].realizedPnl;
    if (p !== null && p >= 0) break;
    lossStreak++;
  }
  const pnlUsd = cents(pnl);
  const trip: LiveTrip | null =
    pnlUsd <= -t.lossUsd ? "loss" : lossStreak >= t.streak ? "streak" : null;
  return { trades: trades.length, pnlUsd, lossStreak, unknown, trip };
}

export interface LiveDemoVerdict {
  decision: Extract<
    LiveAutoDecision,
    "enable" | "wait" | "demo_negative" | "paper_off" | "keep" | "disable_demo"
  >;
  /** Сколько демо-сделок учтено (для обратного порога — последние 30) и их средний R. */
  trades: number;
  avgR: number | null;
}

const mean = (xs: readonly number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;

/**
 * Правило «Авто» по демо (AC4). Реальный счёт выключен: ≥ 30 демо-сделок окна (после включения демо-зеркала, сброса
 * демо и начала эпохи) со средним R > 0 — включить; эксперимент выключен — не включать. Включён: средний R последних
 * 30 демо-сделок (после сброса демо и начала эпохи — смена демо-зеркала окно не обнуляет) < 0 — выключить.
 */
export function liveDemoVerdict(e: {
  enabled: boolean;
  liveOn: boolean;
  /** R демо-сделок окна включения, в порядке закрытия. */
  windowR: readonly number[];
  /** R демо-сделок окна обратного порога, в порядке закрытия. */
  recentR: readonly number[];
}): LiveDemoVerdict {
  if (e.liveOn) {
    const last = e.recentR.slice(-LIVE_AUTO.minDemoTrades);
    const avgR = mean(last);
    const loss =
      e.recentR.length >= LIVE_AUTO.minDemoTrades &&
      avgR !== null &&
      avgR < LIVE_AUTO.rThreshold;
    return {
      decision: loss ? "disable_demo" : "keep",
      trades: last.length,
      avgR,
    };
  }
  const avgR = mean(e.windowR);
  const trades = e.windowR.length;
  if (!e.enabled) return { decision: "paper_off", trades, avgR };
  if (trades < LIVE_AUTO.minDemoTrades)
    return { decision: "wait", trades, avgR };
  return {
    decision:
      avgR !== null && avgR > LIVE_AUTO.rThreshold ? "enable" : "demo_negative",
    trades,
    avgR,
  };
}

export interface LiveAutoInput {
  mode: LiveMirrorMode;
  /** Флаг live_mirror: эксперимент сейчас торгует на реальном счёте. */
  liveOn: boolean;
  enabled: boolean;
  /** Последняя подсказка ручному «Вкл» (experiments.live_mirror_advice). */
  advice: LiveTrip | null;
  thresholds: LiveThresholds;
  /** Закрытые реальные сделки с момента включения, в порядке закрытия. */
  closed: readonly LiveClosedTrade[];
  /** Демо-сделки — только в суточной проверке и при переводе в «Авто»; null — правило по демо не применяется. */
  demo: { windowR: readonly number[]; recentR: readonly number[] } | null;
}

export interface LiveAutoPlan {
  threshold: LiveThresholdVerdict;
  /** null — правило по демо не применялось (не «Авто» или нет демо-данных). */
  demo: LiveDemoVerdict | null;
  /** Итоговое решение для журнала и снимка. */
  decision: LiveAutoDecision;
  /** Что сделать с реальным счётом: включить, выключить (положение → «Выкл» с причиной) или ничего. */
  change: "enable" | "disable" | null;
  /** Ручное «Вкл»: подсказка к отправке; null — не отправлять. */
  sendAdvice: LiveTrip | null;
  /** Новое значение live_mirror_advice; undefined — не менять. */
  adviceState: LiveTrip | null | undefined;
}

const TRIP_DECISION: Record<LiveTrip, LiveAutoDecision> = {
  loss: "disable_loss",
  streak: "disable_streak",
};

/**
 * План по эксперименту (AC3, AC4, AC6). «Выкл» — null: автомат его не трогает (и после автовыключения тоже).
 * «Вкл» — никогда не меняется, только подсказка: одна на появление условия, без повторов, пока оно держится.
 * «Вкл + автовыкл» — выключить по порогу. «Авто» — включён: порог, потом демо; выключен — включить по демо.
 */
export function planLiveAuto(e: LiveAutoInput): LiveAutoPlan | null {
  if (e.mode === "off") return null;
  const threshold = liveThresholdVerdict(e.closed, e.thresholds);
  const base = { threshold, sendAdvice: null, adviceState: undefined };
  if (e.mode === "on") {
    const trip = threshold.trip;
    return {
      ...base,
      demo: null,
      decision: "keep",
      change: null,
      sendAdvice: trip !== null && trip !== e.advice ? trip : null,
      adviceState: trip === e.advice ? undefined : trip,
    };
  }
  // Режим с автоматом: прежняя подсказка ручного «Вкл» больше не нужна.
  const adviceState = e.advice === null ? undefined : null;
  if (e.liveOn && threshold.trip !== null)
    return {
      ...base,
      adviceState,
      demo: null,
      decision: TRIP_DECISION[threshold.trip],
      change: "disable",
    };
  if (e.mode === "on_autooff" || e.demo === null)
    return { ...base, adviceState, demo: null, decision: "keep", change: null };
  const demo = liveDemoVerdict({
    enabled: e.enabled,
    liveOn: e.liveOn,
    ...e.demo,
  });
  return {
    ...base,
    adviceState,
    demo,
    decision: demo.decision,
    change:
      demo.decision === "enable"
        ? "enable"
        : demo.decision === "disable_demo"
          ? "disable"
          : null,
  };
}
