alter table public.referrals
add column if not exists last_reminded_at timestamptz,
add column if not exists updated_at timestamptz not null default timezone('utc', now());

drop trigger if exists referrals_updated_at on public.referrals;
create trigger referrals_updated_at
before update on public.referrals
for each row execute procedure public.handle_updated_at();
