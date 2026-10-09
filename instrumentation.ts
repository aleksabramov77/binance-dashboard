// Next.js вызывает register() один раз при старте сервера: запускаем фоновую автоторговлю.
// Включена ли она — решает переключатель (data/auto-trade.json), по умолчанию выключена.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startAutoTrader } = await import("@/app/server/autoTrade");
  startAutoTrader();
}
