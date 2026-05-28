alter table public.profiles
add column if not exists referred_by_profile_id uuid references public.profiles(id) on delete set null,
add column if not exists referral_code_applied_at timestamptz;

alter table public.referrals
add column if not exists referred_profile_id uuid unique references public.profiles(id) on delete cascade;

create index if not exists profiles_referred_by_profile_id_idx
on public.profiles (referred_by_profile_id);

create index if not exists referrals_referred_profile_id_idx
on public.referrals (referred_profile_id);
