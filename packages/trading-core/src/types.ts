/** Свеча OHLCV. Совпадает по форме с Candle из shared/api/binance — пакет от приложения не зависит. */
export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
