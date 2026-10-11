-- Задание pg_cron `demo-mirror` (spec 008): раз в минуту pg_net вызывает на Vercel
-- POST /api/cron/demo-mirror — свежие paper-входы отмеченных экспериментов повторяются в Binance Demo,
-- демо-позиции закрытых paper-сделок закрываются. Ставится явной командой:
-- pnpm mirror:supabase cron-install (кладёт в Vault demo_mirror_url; секрет — общий monitor_cron_secret
-- = CRON_SECRET Vercel). Идемпотентно.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'demo-mirror',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'demo_mirror_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
