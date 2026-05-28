update public.profiles
set
  total_mined = 0,
  active_referrals = 0,
  total_referrals = 0,
  joined_early = false,
  current_rank = 'miner',
  selected_rank = 'auto',
  current_rate = 1,
  epoch = 0,
  mining_started_at = null,
  session_claimed = true,
  last_claimed_at = null,
  invite_code = 'SFOX-PENDING-0000'
where telegram_user_id is null
  and username = 'pid16';
