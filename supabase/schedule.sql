-- Runs the engine every 15 minutes. Apply once after deploying the engine-tick function.
-- Replace <PROJECT_REF>; the secret is read from Supabase Vault (name: cron_secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'engine-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/engine-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
