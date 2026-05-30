create table if not exists public.network_state (
  key text primary key,
  launch_at timestamptz not null,
  halving_days integer not null default 14,
  total_supply numeric(20,5) not null,
  community_supply_cap numeric(20,5) not null,
  developer_supply_cap numeric(20,5) not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists network_state_updated_at on public.network_state;
create trigger network_state_updated_at
before update on public.network_state
for each row execute procedure public.handle_updated_at();

insert into public.network_state (
  key,
  launch_at,
  halving_days,
  total_supply,
  community_supply_cap,
  developer_supply_cap
)
values (
  'primary',
  '2026-06-01T00:00:00Z',
  14,
  500000000,
  400000000,
  100000000
)
on conflict (key) do update
set
  launch_at = excluded.launch_at,
  halving_days = excluded.halving_days,
  total_supply = excluded.total_supply,
  community_supply_cap = excluded.community_supply_cap,
  developer_supply_cap = excluded.developer_supply_cap;

create table if not exists public.supply_buckets (
  bucket text primary key,
  cap_amount numeric(20,5) not null
);

insert into public.supply_buckets (bucket, cap_amount)
values
  ('community_mining', 400000000),
  ('developer_allocation', 100000000)
on conflict (bucket) do update
set cap_amount = excluded.cap_amount;

create table if not exists public.supply_events (
  id uuid primary key default gen_random_uuid(),
  bucket text not null references public.supply_buckets(bucket) on delete restrict,
  profile_id uuid references public.profiles(id) on delete set null,
  amount numeric(20,5) not null check (amount > 0),
  reference_type text not null,
  reference_id text,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists supply_events_bucket_idx
on public.supply_events (bucket);

create index if not exists supply_events_profile_id_idx
on public.supply_events (profile_id);

create table if not exists public.mining_claims (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  epoch integer not null default 0,
  session_started_at timestamptz not null,
  session_ended_at timestamptz not null,
  claimed_at timestamptz not null default timezone('utc', now()),
  amount numeric(20,5) not null check (amount > 0)
);

create unique index if not exists mining_claims_profile_session_idx
on public.mining_claims (profile_id, session_started_at);

create or replace function public.validate_supply_event_cap()
returns trigger
language plpgsql
as $$
declare
  issued_total numeric(20,5);
  bucket_cap numeric(20,5);
begin
  select coalesce(sum(amount), 0)
  into issued_total
  from public.supply_events
  where bucket = new.bucket;

  select cap_amount
  into bucket_cap
  from public.supply_buckets
  where bucket = new.bucket;

  if bucket_cap is null then
    raise exception 'Unknown supply bucket: %', new.bucket;
  end if;

  if issued_total + new.amount > bucket_cap then
    raise exception 'Supply bucket % exceeds cap', new.bucket;
  end if;

  return new;
end;
$$;

drop trigger if exists supply_events_cap_guard on public.supply_events;
create trigger supply_events_cap_guard
before insert on public.supply_events
for each row execute procedure public.validate_supply_event_cap();

create or replace view public.supply_summary as
select
  b.bucket,
  b.cap_amount,
  coalesce(sum(e.amount), 0) as issued_amount,
  b.cap_amount - coalesce(sum(e.amount), 0) as remaining_amount
from public.supply_buckets b
left join public.supply_events e on e.bucket = b.bucket
group by b.bucket, b.cap_amount;

alter table public.network_state enable row level security;
alter table public.supply_buckets enable row level security;
alter table public.supply_events enable row level security;
alter table public.mining_claims enable row level security;

drop policy if exists "public can read network state" on public.network_state;
create policy "public can read network state"
on public.network_state
for select
using (true);

drop policy if exists "public can read supply buckets" on public.supply_buckets;
create policy "public can read supply buckets"
on public.supply_buckets
for select
using (true);

drop policy if exists "public can read supply events" on public.supply_events;
create policy "public can read supply events"
on public.supply_events
for select
using (true);

drop policy if exists "public can manage supply events" on public.supply_events;
create policy "public can manage supply events"
on public.supply_events
for all
using (true)
with check (true);

drop policy if exists "public can read mining claims" on public.mining_claims;
create policy "public can read mining claims"
on public.mining_claims
for select
using (true);

drop policy if exists "public can manage mining claims" on public.mining_claims;
create policy "public can manage mining claims"
on public.mining_claims
for all
using (true)
with check (true);
