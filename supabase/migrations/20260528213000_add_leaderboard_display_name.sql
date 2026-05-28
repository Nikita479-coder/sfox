drop view if exists public.leaderboard;

create view public.leaderboard as
select
  p.username,
  p.telegram_first_name,
  coalesce(nullif(trim(p.telegram_first_name), ''), p.username) as display_name,
  p.current_rank,
  p.total_mined,
  p.active_referrals,
  p.total_referrals,
  p.current_rate
from public.profiles p
order by p.total_mined desc, p.active_referrals desc, p.created_at asc;
