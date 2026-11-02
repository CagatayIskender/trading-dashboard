-- Trading system schema. The engine (Edge Function, service role) writes;
-- the signed-in owner reads everything and can decide approvals and edit settings.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text not null check (mode in ('demo', 'live')),
  active boolean not null default true,
  config jsonb not null,          -- EngineConfig, edited from the panel
  state jsonb not null,           -- PortfolioState, written by the engine
  last_strategy_day date,         -- strategies run once per day
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fills (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts on delete cascade,
  t timestamptz not null,
  symbol text not null,
  sleeve text not null,
  side text not null check (side in ('buy', 'sell')),
  qty double precision not null,
  price_eur double precision not null,
  fee_eur double precision not null,
  realized_pnl_eur double precision,
  reason text not null
);
create index fills_account_t on public.fills (account_id, t desc);

create table public.approvals (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts on delete cascade,
  created_at timestamptz not null default now(),
  intent jsonb not null,          -- OrderIntent
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'executed', 'expired')),
  decided_at timestamptz,
  executed_price_eur double precision,  -- what the user actually paid in Trade Republic
  executed_qty double precision
);
create index approvals_pending on public.approvals (account_id) where status = 'pending';

create table public.equity_snapshots (
  account_id uuid not null references public.accounts on delete cascade,
  t timestamptz not null,
  equity_eur double precision not null,
  cash_eur double precision not null,
  benchmark_eur double precision,
  primary key (account_id, t)
);

create table public.events (
  id bigint generated always as identity primary key,
  account_id uuid references public.accounts on delete cascade,
  t timestamptz not null default now(),
  level text not null check (level in ('info', 'warn', 'risk')),
  message text not null
);
create index events_account_t on public.events (account_id, t desc);

-- Written by the scheduled Claude analysis (news, trends, financial statements).
create table public.signals (
  id bigint generated always as identity primary key,
  symbol text not null,
  score double precision not null check (score between -1 and 1),
  horizon text not null check (horizon in ('short', 'medium', 'long')),
  rationale text not null,
  sources jsonb not null default '[]',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index signals_live on public.signals (symbol, expires_at desc);

-- Daily bar cache so each tick only downloads the last few days.
create table public.market_bars (
  symbol text not null,
  day date not null,
  o double precision not null,
  h double precision not null,
  l double precision not null,
  c double precision not null,
  v double precision not null,
  primary key (symbol, day)
);

alter table public.accounts enable row level security;
alter table public.fills enable row level security;
alter table public.approvals enable row level security;
alter table public.equity_snapshots enable row level security;
alter table public.events enable row level security;
alter table public.signals enable row level security;
alter table public.market_bars enable row level security;

-- Single-owner app: any signed-in user is the owner (sign-ups are disabled in Auth settings).
create policy "owner reads" on public.accounts for select to authenticated using (true);
create policy "owner edits settings" on public.accounts for update to authenticated using (true) with check (true);
create policy "owner reads" on public.fills for select to authenticated using (true);
create policy "owner reads" on public.approvals for select to authenticated using (true);
create policy "owner decides" on public.approvals for update to authenticated using (true) with check (true);
create policy "owner reads" on public.equity_snapshots for select to authenticated using (true);
create policy "owner reads" on public.events for select to authenticated using (true);
create policy "owner reads" on public.signals for select to authenticated using (true);
create policy "owner reads" on public.market_bars for select to authenticated using (true);
