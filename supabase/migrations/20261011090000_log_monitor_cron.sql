-- Задание pg_cron `log-monitor` (платформа): каждые 15 минут pg_net вызывает на Vercel
-- POST /api/cron/log-monitor — монитор журнала ищет сбои и пишет в Telegram. Ставится явной командой:
-- pnpm monitor:supabase cron-install (скрипт кладёт в Vault log_monitor_url и monitor_cron_secret = CRON_SECRET).
-- Идемпотентно.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'log-monitor',
  '*/15 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'log_monitor_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
