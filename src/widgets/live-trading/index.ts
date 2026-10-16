// Реальный счёт на страницах лаборатории (spec 0049): переключатель эксперимента, аварийный стоп и полоса над
// таблицей /experiments. Домен «Лаборатория»; данные — entities/live-account и entities/experiment.

export { dailyLimitNote, haltText } from "./lib/describe";
export { LiveHaltControls } from "./ui/LiveHaltControls";
export { LiveMirrorToggle } from "./ui/LiveMirrorToggle";
export { LIVE_STOP_HREF, LiveTradingStrip } from "./ui/LiveTradingStrip";
