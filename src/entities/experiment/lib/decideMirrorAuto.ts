import { MIN_TRADES, R_THRESHOLD } from "../config/mirrorAuto";
import { DEMO_MIRROR_MARKETS, type Market } from "../model/assetGroup";
import type {
  DemoMirrorMode,
  MirrorAdvice,
  MirrorAutoDecision,
  MirrorAutoSnapshot,
} from "../model/mirrorAuto";

// Правило авто-зеркала (spec 0043) — чистая функция: эксперимент с положением и окном сделок → изменение зеркала
// и подсказка. Без БД, биржи и времени — их передаёт композиция src/app/server/mirrorAuto.ts.

/**
 * Начало окна: самый поздний из моментов — старт эпохи, отдельный сброс paper-капитала, последнее изменение зеркала.
 * Новая эпоха, сброс или включение/выключение зеркала начинают окно заново (AC6).
 */
export function mirrorWindowStart(...starts: (Date | null)[]): number {
  return Math.max(
    ...starts.map((d) => (d ? d.getTime() : Number.NEGATIVE_INFINITY)),
  );
}

/** R сделок окна (открыты не раньше начала) в порядке закрытия. */
export function mirrorWindowR(
  trades: { openedAt: Date; rMultiple: number }[],
  start: number,
): number[] {
  return trades
    .filter((t) => t.openedAt.getTime() >= start)
    .map((t) => t.rMultiple);
}

export interface MirrorAutoInput {
  id: string;
  market: Market;
  enabled: boolean;
  demoMirror: boolean;
  mode: DemoMirrorMode;
  /** Последняя отправленная подсказка (experiments.demo_mirror_advice). */
  advice: MirrorAdvice | null;
  /** R закрытых сделок окна в порядке закрытия (mirrorWindowR). */
  windowR: number[];
}

/** Что решил (или решил бы) автомат: решение, сколько сделок учтено и их средний R. */
export interface MirrorAutoVerdict {
  decision: MirrorAutoDecision;
  trades: number;
  avgR: number | null;
}

export interface MirrorAutoPlan {
  id: string;
  mode: DemoMirrorMode;
  verdict: MirrorAutoVerdict;
  /** «Авто»: новое значение зеркала, если автомат его меняет. */
  change: boolean | null;
  /** Ручное положение: подсказка к отправке (что сделал бы автомат); null — не отправлять. */
  sendAdvice: MirrorAdvice | null;
  /** Новое значение demo_mirror_advice; undefined — не менять. */
  adviceState: MirrorAdvice | null | undefined;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Таблица правила для текущего флага зеркала — без учёта положения переключателя. */
export function mirrorAutoVerdict(
  e: Pick<MirrorAutoInput, "enabled" | "demoMirror" | "windowR">,
  canEnable: boolean,
): MirrorAutoVerdict {
  const r = e.windowR;
  if (e.demoMirror) {
    // Правило 2: эксперимент выключен — зеркало ему не нужно, сколько бы ни было сделок.
    if (!e.enabled)
      return {
        decision: "disable_off",
        trades: r.length,
        avgR: r.length ? mean(r) : null,
      };
    // Правило 3: скользящее окно из последних MIN_TRADES — поздний обвал тоже снимает зеркало.
    const last = r.slice(-MIN_TRADES);
    const avgR = last.length ? mean(last) : null;
    const loss = r.length >= MIN_TRADES && avgR !== null && avgR < R_THRESHOLD;
    return {
      decision: loss ? "disable_loss" : "keep",
      trades: last.length,
      avgR,
    };
  }
  // Правило 1: все сделки окна (после выключения — только новые).
  const avgR = r.length ? mean(r) : null;
  const profit =
    e.enabled && r.length >= MIN_TRADES && avgR !== null && avgR > R_THRESHOLD;
  return {
    decision: profit ? (canEnable ? "enable" : "no_key") : "keep",
    trades: r.length,
    avgR,
  };
}

const ACTION: Partial<Record<MirrorAutoDecision, MirrorAdvice>> = {
  enable: "on",
  disable_loss: "off",
  disable_off: "off",
};

/**
 * Решение по эксперименту; null — группа без демо-зеркала (с spec 0056 зеркало есть у всех групп, у COIN-M тоже).
 * «Авто» — автомат меняет зеркало; «Вкл» / «Выкл» — не меняет никогда (AC4), только подсказка: одна на появление
 * условия, пока оно держится — без повторов; условие ушло — подсказка сбрасывается и может прийти снова.
 * canEnable = false (нет ключа Binance Demo) — ничего не включает и не подсказывает включить.
 */
export function decideMirrorAuto(
  e: MirrorAutoInput,
  canEnable: boolean,
): MirrorAutoPlan | null {
  if (!(DEMO_MIRROR_MARKETS as readonly Market[]).includes(e.market))
    return null;
  const verdict = mirrorAutoVerdict(e, canEnable);
  const action = ACTION[verdict.decision] ?? null;
  if (e.mode === "auto")
    return {
      id: e.id,
      mode: e.mode,
      verdict,
      change: action === null ? null : action === "on",
      sendAdvice: null,
      adviceState: e.advice === null ? undefined : null,
    };
  const fresh = action !== null && action !== e.advice;
  return {
    id: e.id,
    mode: e.mode,
    verdict,
    change: null,
    sendAdvice: fresh ? action : null,
    adviceState: action === e.advice ? undefined : action,
  };
}

/**
 * Снимок после проверки «Авто»: последняя проверка — всегда новая, последнее изменение — только если автомат поменял
 * зеркало (change), иначе прежнее: «оставил» не затирает, почему зеркало включено или выключено.
 */
export function nextMirrorAutoSnapshot(
  prev: MirrorAutoSnapshot | null,
  verdict: MirrorAutoVerdict,
  demoMirror: boolean,
  changed: boolean,
  at: string,
): MirrorAutoSnapshot {
  const check = { ...verdict, demoMirror };
  return {
    checkedAt: at,
    check,
    change: changed ? { at, ...check } : (prev?.change ?? null),
  };
}
