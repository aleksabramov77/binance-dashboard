// Next.js вызывает register() один раз при старте сервера: подключаем журнал к БД, применяем миграции и запускаем
// таймер движка лаборатории (spec 003, engine_state.enabled; по умолчанию выключен) и фоновых задач (spec 0048).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Журнал — в БД (и на Vercel): приёмник логгера подключаем до всех остальных шагов.
  const { setLogSink } = await import("@/shared/lib/logger.server");
  const { writeLogs } = await import("@/app/server/logs");
  setLogSink(writeLogs);
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
  const { startExperimentEngine } = await import(
    "@/app/server/experimentEngine"
  );
  startExperimentEngine();
  // Снимок Earn, монитор журнала, демо- и авто-зеркало — таймерами процесса (spec 0048), только на VM (APP_HOST=vm);
  // выполняются, только когда engine_state.runner = ENGINE_RUNNER, пока runner = supabase их запускает pg_cron.
  const { startBackgroundJobs } = await import("@/app/server/backgroundJobs");
  startBackgroundJobs();
}
