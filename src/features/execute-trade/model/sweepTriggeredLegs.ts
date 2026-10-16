import type { TradeStep } from "@/entities/trade";
import {
  type DemoProtectRefs,
  demoCancelAlgoOrder,
  fetchDemoAlgoOrder,
  fetchDemoFuturesOrder,
  fetchDemoOpenAlgoOrders,
} from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import {
  afterTriggeredLeg,
  algoLeg,
  algoLookup,
  orphanLegCandidate,
} from "../lib/closePlan";
import { errorText } from "./tradeSteps";

export interface OpenMirrorLegs {
  tradeId: string;
  symbol: string;
  /** Статус строки: уже unprotected — повторно не сообщаем. */
  status?: string;
  protectRefs: DemoProtectRefs;
}

export interface SweptMirror {
  tradeId: string;
  symbol: string;
  /**
   * closed — позицию закрыла биржа своей ногой; unprotected — нога сработала раньше, чем исполнился
   * вход (объём 0): позиция открыта без стопа.
   */
  status: "closed" | "unprotected";
  /** Чем закрыла биржа: свой стоп или тейк. */
  closedBy: "stop" | "takeProfit";
  /** Средняя цена исполнения сработавшей ноги; неизвестна — null. */
  exitPrice: number | null;
  message: string;
  steps: TradeStep[];
}

const LEG = { stop: "стоп", takeProfit: "тейк" } as const;

/**
 * Сверка своих ног открытых фьючерсных зеркал (spec 0012, PR 2d): своя нога сработала, вторая
 * висит — снять её сразу (иначе reduceOnly-ордер закрыл бы объём соседнего зеркала монеты). Одна
 * выборка открытых algo-ордеров счёта + статус только «пропавших» своих ног. Возвращает зеркала,
 * чью позицию уже закрыла биржа (вторая нога снята). Сбой сети — пусто, повтор на следующем прогоне.
 */
export async function sweepTriggeredLegs(
  mirrors: OpenMirrorLegs[],
  overBudget: () => boolean = () => false,
): Promise<SweptMirror[]> {
  const config = getDemoTradingConfig();
  // Зеркала с хотя бы одной своей ногой; одна нога (stopOnly) — сработала: строка закрыта, снимать нечего.
  const futures = mirrors.filter(
    (m) =>
      m.protectRefs.market === "usdm" &&
      (m.protectRefs.stop || m.protectRefs.takeProfit),
  );
  if (!config || futures.length === 0) return [];
  const creds = config.credentials;
  let openAlgos: Awaited<ReturnType<typeof fetchDemoOpenAlgoOrders>>;
  try {
    openAlgos = await fetchDemoOpenAlgoOrders(creds);
  } catch (error) {
    log.warn(
      "mirror.legs",
      `Открытые algo-ордера не загрузились: ${errorText(error)}`,
    );
    return [];
  }
  const swept: SweptMirror[] = [];
  for (const m of futures) {
    // Бюджет прогона: остальные зеркала сверим на следующей минуте.
    if (overBudget()) break;
    const refs = m.protectRefs;
    if (refs.market !== "usdm") continue;
    const candidate = orphanLegCandidate(refs, openAlgos);
    if (!candidate) continue;
    const remaining = candidate.remaining;
    const missingRef = refs[candidate.missing];
    const missingLookup = missingRef && algoLookup(missingRef);
    const remainingRef = remaining ? refs[remaining] : null;
    const remainingLookup = remainingRef ? algoLookup(remainingRef) : null;
    if (!missingLookup || (remaining && !remainingLookup)) continue;
    const steps: TradeStep[] = [];
    try {
      const q = await fetchDemoAlgoOrder(creds, missingLookup);
      // Нога снята не срабатыванием (вручную, истекла) — не наше дело: закроется по paper-сделке.
      if (!q || !algoLeg(q).triggered) continue;
      // Сколько исполнила нога: 0 — сработала раньше входа (стоп до входа), позиция без стопа.
      const executed =
        q.actualQty > 0
          ? q.actualQty
          : q.actualOrderId !== null
            ? ((
                await fetchDemoFuturesOrder(creds, m.symbol, {
                  orderId: q.actualOrderId,
                })
              )?.executedQty ?? 0)
            : 0;
      if (afterTriggeredLeg(executed) === "unprotected") {
        if (m.status === "unprotected") continue;
        swept.push({
          tradeId: m.tradeId,
          symbol: m.symbol,
          status: "unprotected",
          closedBy: candidate.missing,
          exitPrice: null,
          message: `Свой ${LEG[candidate.missing]} сработал раньше, чем исполнился вход (объём 0) — позиция открыта без стопа, проверьте на demo.binance.com.`,
          steps: [
            {
              label: `Сработал свой ${LEG[candidate.missing]}`,
              ok: false,
              detail: `${q.algoStatus}, ордер #${q.actualOrderId}, исполнено 0`,
            },
          ],
        });
        continue;
      }
      steps.push({
        label: `Сработал свой ${LEG[candidate.missing]}`,
        ok: true,
        detail: `${q?.algoStatus}, ордер #${q?.actualOrderId}, ~${q?.actualPrice || "—"}`,
      });
      if (remaining && remainingLookup) {
        const cancelled = await demoCancelAlgoOrder(creds, remainingLookup);
        steps.push({
          label: `Снять свой ${LEG[remaining]}`,
          ok: true,
          detail: cancelled ? "Снят" : "Уже не активен",
        });
      }
      swept.push({
        tradeId: m.tradeId,
        symbol: m.symbol,
        status: "closed",
        closedBy: candidate.missing,
        exitPrice: q && q.actualPrice > 0 ? q.actualPrice : null,
        message: remaining
          ? `Позиция закрыта биржей: сработал ${LEG[candidate.missing]}, ${LEG[remaining]} снят.`
          : `Позиция закрыта биржей: сработал ${LEG[candidate.missing]}.`,
        steps,
      });
    } catch (error) {
      // Не получилось — повторим на следующем прогоне (строка остаётся открытой).
      log.warn(
        "mirror.legs",
        `${m.symbol}: вторая нога не снята — ${errorText(error)}`,
        { tradeId: m.tradeId },
      );
    }
  }
  return swept;
}
