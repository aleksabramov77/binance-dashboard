-- Задание pg_cron `earn-snapshot` (домен Earn): дважды в день — 09:00 и 21:00 по Бишкеку (03:00 и 15:00 UTC) —
-- pg_net вызывает на Vercel POST /api/cron/earn-snapshot, роут скачивает предложения Simple Earn и пишет
-- снимок в таблицу earn_snapshots. Ставится явной командой: pnpm earn:supabase cron-install
-- (скрипт сначала кладёт в Vault earn_snapshot_url и earn_cron_secret = CRON_SECRET Vercel). Идемпотентно.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'earn-snapshot',
  '0 3,15 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'earn_snapshot_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'earn_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
