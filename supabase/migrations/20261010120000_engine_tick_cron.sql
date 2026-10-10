-- Задание pg_cron `engine-tick-every-minute` (spec 007b, AC3): раз в минуту pg_net вызывает Edge Function
-- engine-tick в Токио. Не в drizzle/: pg_cron и pg_net есть только в Supabase (в PGlite тестов их нет), а
-- drizzle-миграции применяются автоматически (`pnpm dev` с DATABASE_URL, `pnpm db:migrate`) — запуск
-- ежеминутного тика в проде должен быть явной командой владельца:
--   pnpm engine:supabase cron-install
-- Скрипт сначала кладёт в Vault секреты engine_tick_url и engine_tick_secret, затем выполняет этот файл.
-- Идемпотентно: расширения — if not exists, cron.schedule с тем же именем заменяет задание.
-- Адрес и ключ вызова читаются из Vault при каждом запуске — в коде и в cron.job их нет.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'engine-tick-every-minute',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'engine_tick_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'engine_tick_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
