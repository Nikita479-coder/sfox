alter table public.profiles
add column if not exists session_accrued numeric(20,6) not null default 0,
add column if not exists session_accrual_updated_at timestamptz;

update public.profiles
set
  session_accrued = coalesce(session_accrued, 0),
  session_accrual_updated_at = case
    when mining_started_at is not null and session_claimed = false then coalesce(session_accrual_updated_at, mining_started_at)
    else session_accrual_updated_at
  end;
