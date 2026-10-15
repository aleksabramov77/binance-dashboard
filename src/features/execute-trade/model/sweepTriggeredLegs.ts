import type { TradeStep } from "@/entities/trade";
import {
  type DemoProtectRefs,
  demoCancelAlgoOrder,
  fetchDemoAlgoOrder,
  fetchDemoOpenAlgoOrders,
} from "@/shared/api/binance/demo.server";
import { getDemoTradingConfig } from "@/shared/config/env.server";
import { log } from "@/shared/lib/logger.server";
import { algoLeg, algoLookup, orphanLegCandidate } from "../lib/closePlan";
import { errorText } from "./tradeSteps";

export interface OpenMirrorLegs {
  tradeId: string;
  symbol: string;
  protectRefs: DemoProtectRefs;
}

export interface SweptMirror {
  tradeId: string;
  symbol: string;
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
): Promise<SweptMirror[]> {
  const config = getDemoTradingConfig();
  const futures = mirrors.filter(
    (m) =>
      m.protectRefs.market === "futures" &&
      m.protectRefs.stop &&
      m.protectRefs.takeProfit,
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
    const refs = m.protectRefs;
    if (refs.market !== "futures") continue;
    const candidate = orphanLegCandidate(refs, openAlgos);
    if (!candidate) continue;
    const missingRef = refs[candidate.missing];
    const remainingRef = refs[candidate.remaining];
    const missingLookup = missingRef && algoLookup(missingRef);
    const remainingLookup = remainingRef && algoLookup(remainingRef);
    if (!missingLookup || !remainingLookup) continue;
    const steps: TradeStep[] = [];
    try {
      const q = await fetchDemoAlgoOrder(creds, missingLookup);
      // Нога снята не срабатыванием (вручную, истекла) — не наше дело: закроется по paper-сделке.
      if (!algoLeg(q).triggered) continue;
      const cancelled = await demoCancelAlgoOrder(creds, remainingLookup);
      steps.push({
        label: `Сработал свой ${LEG[candidate.missing]}`,
        ok: true,
        detail: `${q?.algoStatus}, ордер #${q?.actualOrderId}, ~${q?.actualPrice || "—"}`,
      });
      steps.push({
        label: `Снять свой ${LEG[candidate.remaining]}`,
        ok: true,
        detail: cancelled ? "Снят" : "Уже не активен",
      });
      swept.push({
        tradeId: m.tradeId,
        symbol: m.symbol,
        closedBy: candidate.missing,
        exitPrice: q && q.actualPrice > 0 ? q.actualPrice : null,
        message: `Позиция закрыта биржей: сработал ${LEG[candidate.missing]}, ${LEG[candidate.remaining]} снят.`,
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
