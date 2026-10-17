import type { TradeResult } from "@/entities/trade";
import {
  BinanceApiError,
  type DemoProtectRefs,
} from "@/shared/api/binance/demo.server";
import { recheckStep } from "../lib/futuresMode";
import type { TradeOutcome } from "../lib/tradeOutcome";

// Общие шаги сделки (spot и futures): повторы, перечитывание с дедлайнами, типы завершения.

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Позиция ещё не видна сразу после входа — повторяем: -4509 у algo TP/SL, -2022 у reduceOnly
 * (закрытие по рынку, защита в One-way). fn вызывается заново на каждую попытку — вызывающий
 * помечает в нём время последней отправки (дедлайн перечитывания считается от неё).
 */
const POSITION_RETRY_DELAYS_MS = [1000, 2000];
const POSITION_NOT_READY = [-4509, -2022];

export async function withPositionRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (const delay of POSITION_RETRY_DELAYS_MS) {
    try {
      return await fn();
    } catch (error) {
      if (
        !(
          error instanceof BinanceApiError &&
          POSITION_NOT_READY.includes(error.code ?? 0)
        )
      )
        throw error;
      await sleep(delay);
    }
  }
  return fn();
}

/** Общий срок сделки истёк раньше, чем «нет» стало окончательным: исход неизвестен. */
export class TradeDeadlineError extends Error {}

/**
 * Перечитывать, пока не найдётся или пока проверка не будет начата после дедлайна перечитывания
 * (unknownOutcomeDeadline: отправка + recvWindow — позже биржа заявку в движок не передаст).
 * Раньше дедлайна «не найдено» — не вердикт; истёк общий срок сделки — TradeDeadlineError.
 */
export async function recheckUntil<T>(
  deadline: number,
  tradeDeadline: number,
  read: () => Promise<T>,
  found: (value: T) => boolean,
): Promise<T> {
  for (;;) {
    const startedAt = Date.now();
    const value = await read();
    const step = recheckStep(
      found(value),
      Date.now(),
      startedAt,
      deadline,
      tradeDeadline,
    );
    if (step === "found" || step === "final") return value;
    if (step === "giveUp")
      throw new TradeDeadlineError(
        "Общий срок сделки истёк — исход на бирже не проверен до конца",
      );
    await sleep(step.wait);
  }
}

export type Finish = (
  status: TradeResult["status"],
  message: string,
  entryPrice?: number | null,
  filledQuantity?: number | null,
) => TradeResult;

/** Свои защитные ордера сделки (PR 2b): заполняются по ходу, уходят в TradeResult.protectRefs. */
export interface RefsHolder {
  current: DemoProtectRefs | null;
}

/** Завершить сделку выбранным исходом (lib/tradeOutcome); цена и объём — только если позиция есть. */
export type Done = (
  o: TradeOutcome,
  entryPrice?: number,
  filled?: number,
) => TradeResult;

/** Вход исполнен, защита ещё не выставлена (spec 0068, B1): цена и объём исполнения. */
export interface TradeFill {
  entryPrice: number;
  filledQuantity: number;
}

/**
 * Сообщить об исполнении входа до выставления защиты. Синхронно и без ожидания: защита не ждёт сети; сбой
 * получателя сделку не ломает.
 */
export type OnFilled = (fill: TradeFill) => void;

export function reportFilled(cb: OnFilled | undefined, fill: TradeFill) {
  try {
    cb?.(fill);
  } catch {
    // Получатель — уведомление о шаге; сделка от него не зависит.
  }
}
