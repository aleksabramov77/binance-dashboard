// Next.js вызывает register() один раз при старте сервера: применяем миграции БД и запускаем
// фоновую автоторговлю. Включена ли она — решает переключатель (data/auto-trade.json), по умолчанию выключена.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { migrateDb } = await import("@/shared/db/client.server");
  const { log } = await import("@/shared/lib/logger.server");
  // Сбой БД не должен ронять остальной дашборд: ошибка — в журнал.
  await migrateDb().catch((error) =>
    log.error("db.migrate", "Миграции не применены", undefined, error),
  );
  const { startAutoTrader } = await import("@/app/server/autoTrade");
  startAutoTrader();
}
