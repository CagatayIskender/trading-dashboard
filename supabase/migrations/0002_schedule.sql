-- Secret shared by pg_cron and the Edge Functions. RLS on with no policies:
-- only the service role (Edge Functions) and the database itself can read it.
create table public.app_secrets (name text primary key, value text not null);
alter table public.app_secrets enable row level security;
insert into public.app_secrets (name, value) values ('cron_secret', encode(extensions.gen_random_bytes(32), 'hex'));

-- Results of backtests run on Supabase, shown in the panel.
create table public.backtest_runs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  range text not null,
  config jsonb not null,
  metrics jsonb not null,
  curve jsonb not null,
  fills jsonb not null
);
alter table public.backtest_runs enable row level security;
create policy "owner reads" on public.backtest_runs for select to authenticated using (true);

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Calls an Edge Function with the shared secret. Used by the cron job and for manual runs.
create or replace function public.call_function(fn text, payload jsonb default '{}'::jsonb)
returns bigint
language sql
security definer
set search_path = public, extensions
as $$
  select net.http_post(
    url := 'https://dljsznnfhyigjonojvfl.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select value from public.app_secrets where name = 'cron_secret')
    ),
    body := payload,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function public.call_function(text, jsonb) from public, anon, authenticated;

select cron.schedule('engine-tick', '*/15 * * * *', $$ select public.call_function('engine-tick') $$);
