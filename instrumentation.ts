// Next.js вызывает register() один раз при старте сервера: применяем миграции БД и запускаем
// фоновую автоторговлю (spec 002, data/auto-trade.json) и таймер движка лаборатории (spec 003,
// engine_state.enabled). Оба по умолчанию выключены.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { isServerless } = await import("@/shared/config/env.server");
  // Serverless (Vercel): процесс живёт только на время запроса — фоновых таймеров нет, а миграции
  // применяются отдельно (`pnpm db:migrate`), а не на каждом холодном старте. Тик — снаружи (spec 007b).
  if (isServerless()) return;
  const { migrateDb } = await import("@/shared/db/client.server");
  const { log } = await import("@/shared/lib/logger.server");
  // Сбой БД не должен ронять остальной дашборд: ошибка — в журнал.
  await migrateDb().catch((error) =>
    log.error("db.migrate", "Миграции не применены", undefined, error),
  );
  const { startAutoTrader } = await import("@/app/server/autoTrade");
  startAutoTrader();
  const { startExperimentEngine } = await import(
    "@/app/server/experimentEngine"
  );
  startExperimentEngine();
}
