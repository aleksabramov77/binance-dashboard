-- Задание pg_cron `mirror-auto` (spec 0043): раз в сутки в 07:00 UTC pg_net вызывает на Vercel
-- POST /api/cron/mirror-auto — авто-зеркало включает и выключает демо-зеркала экспериментов в «Авто» по
-- paper-сделкам и подсказывает в Telegram по ручным положениям. Ставится явной командой:
-- pnpm mirror:supabase cron-install-auto (кладёт в Vault mirror_auto_url; секрет — общий monitor_cron_secret
-- = CRON_SECRET Vercel). Идемпотентно.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'mirror-auto',
  '0 7 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'mirror_auto_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'monitor_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
