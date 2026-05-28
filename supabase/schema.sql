create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  username text not null unique,
  invite_code text not null unique,
  joined_early boolean not null default false,
  selected_rank text not null default 'auto',
  current_rank text not null default 'miner',
  epoch integer not null default 0,
  active_referrals integer not null default 0,
  total_referrals integer not null default 0,
  total_mined numeric(20,5) not null default 0,
  current_rate numeric(20,3) not null default 1,
  mining_started_at timestamptz,
  session_claimed boolean not null default true,
  last_claimed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_profile_id uuid not null references public.profiles(id) on delete cascade,
  referred_username text not null,
  referred_rank text not null default 'miner',
  is_active boolean not null default false,
  last_reminded_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  eyebrow text not null default '@SFOXCoreTeam',
  title text not null,
  body text not null,
  primary_cta_label text not null default 'Announcement',
  secondary_cta_label text not null default 'Open forum',
  primary_cta_target text,
  secondary_cta_target text,
  is_active boolean not null default true,
  published_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
before update on public.profiles
for each row execute procedure public.handle_updated_at();

drop trigger if exists referrals_updated_at on public.referrals;
create trigger referrals_updated_at
before update on public.referrals
for each row execute procedure public.handle_updated_at();

create or replace view public.leaderboard as
select
  p.username,
  p.current_rank,
  p.total_mined,
  p.active_referrals,
  p.total_referrals,
  p.current_rate
from public.profiles p
order by p.total_mined desc, p.active_referrals desc, p.created_at asc;

alter table public.profiles enable row level security;
alter table public.referrals enable row level security;
alter table public.announcements enable row level security;

drop policy if exists "public can read announcements" on public.announcements;
create policy "public can read announcements"
on public.announcements
for select
using (true);

drop policy if exists "public can read leaderboard profiles" on public.profiles;
create policy "public can read leaderboard profiles"
on public.profiles
for select
using (true);

drop policy if exists "public can manage demo profiles by username" on public.profiles;
create policy "public can manage demo profiles by username"
on public.profiles
for all
using (true)
with check (true);

drop policy if exists "public can read referrals" on public.referrals;
create policy "public can read referrals"
on public.referrals
for select
using (true);

drop policy if exists "public can manage referrals" on public.referrals;
create policy "public can manage referrals"
on public.referrals
for all
using (true)
with check (true);

insert into public.announcements (
  slug,
  eyebrow,
  title,
  body,
  primary_cta_label,
  secondary_cta_label
)
values (
  'possible-rate-live',
  '@SFOXCoreTeam',
  'Your possible rate now updates from active miners only.',
  'Open the possible rate button on the right to see the full breakdown: base rate x referral boosters x rank reward booster. Referral boosters come only from active overflow miners, while rank rewards are fixed by your current rank.',
  'Announcement',
  'Open forum'
)
on conflict (slug) do update
set
  title = excluded.title,
  body = excluded.body,
  primary_cta_label = excluded.primary_cta_label,
  secondary_cta_label = excluded.secondary_cta_label,
  is_active = true;
