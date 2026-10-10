import type {
  ExitReason,
  ExperimentMarket,
  TradeDirection,
} from "./experiment";

/** Комиссия taker Binance без скидок: spot 0,1%, USDⓈ-M futures 0,05%. */
export const FEE_RATE: Record<ExperimentMarket, number> = {
  spot: 0.001,
  futures: 0.0005,
};

/** Проскальзывание рыночного ордера. */
export const SLIPPAGE = 0.0005;

const sign = (d: TradeDirection) => (d === "long" ? 1 : -1);

/** Цена входа по рынку: long покупает дороже, short продаёт дешевле. */
export const entryFill = (price: number, direction: TradeDirection) =>
  price * (1 + sign(direction) * SLIPPAGE);

/** Цена выхода: тейк — лимитный ордер по уровню, остальные выходы — по рынку с проскальзыванием. */
export const exitFill = (
  price: number,
  direction: TradeDirection,
  reason: ExitReason,
) => (reason === "tp" ? price : price * (1 - sign(direction) * SLIPPAGE));

export interface SettleInput {
  market: ExperimentMarket;
  direction: TradeDirection;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  initialStop: number | null;
}

export interface Settlement {
  /** Комиссии входа и выхода, USD. */
  fees: number;
  /** PnL после комиссий, USD. */
  pnl: number;
  /** PnL в единицах риска (R); null — без стопа. */
  rMultiple: number | null;
}

/** Итог закрытой сделки: комиссии с обеих сторон, PnL и R. */
export function settle(t: SettleInput): Settlement {
  const rate = FEE_RATE[t.market];
  const fees = rate * t.quantity * (t.entryPrice + t.exitPrice);
  const pnl =
    sign(t.direction) * (t.exitPrice - t.entryPrice) * t.quantity - fees;
  const risk =
    t.initialStop === null
      ? 0
      : Math.abs(t.entryPrice - t.initialStop) * t.quantity;
  return { fees, pnl, rMultiple: risk > 0 ? pnl / risk : null };
}

/** Текущий PnL открытой позиции по цене mark, с комиссией входа и будущего выхода. */
export const unrealizedPnl = (
  t: Omit<SettleInput, "exitPrice" | "initialStop">,
  mark: number,
) => settle({ ...t, exitPrice: mark, initialStop: null }).pnl;
