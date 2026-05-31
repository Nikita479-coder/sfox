insert into public.profiles (
  username,
  invite_code,
  joined_early,
  selected_rank,
  current_rank,
  epoch,
  active_referrals,
  total_referrals,
  total_mined,
  current_rate,
  session_claimed
)
values
  ('NovaPrime', 'Satyra-NOVA-TITAN', true, 'auto', 'titan', 2, 612, 700, 84210.44112, 50.25, true),
  ('AtlasForge', 'Satyra-ATLAS-PRES', true, 'auto', 'president', 2, 284, 335, 70114.99348, 28.600, true),
  ('LunaGrid', 'Satyra-LUNA-BARON', true, 'auto', 'baron', 2, 138, 180, 56433.10495, 14.750, true),
  ('SoraVault', 'Satyra-SORA-LORD', true, 'auto', 'lord', 2, 77, 102, 41892.62004, 7.840, true),
  ('KairoMesh', 'Satyra-KAIRO-LORD', true, 'auto', 'lord', 2, 52, 61, 36720.88194, 6.240, true),
  ('VegaPulse', 'Satyra-VEGA-PION', true, 'auto', 'pioneer', 2, 18, 26, 29110.44103, 3.300, true),
  ('NexaFlow', 'Satyra-NEXA-BARON', true, 'auto', 'baron', 2, 109, 148, 24880.19442, 12.350, true),
  ('OrionMint', 'Satyra-ORION-PRES', true, 'auto', 'president', 2, 172, 241, 22914.10205, 20.100, true)
on conflict (username) do update
set
  invite_code = excluded.invite_code,
  joined_early = excluded.joined_early,
  selected_rank = excluded.selected_rank,
  current_rank = excluded.current_rank,
  epoch = excluded.epoch,
  active_referrals = excluded.active_referrals,
  total_referrals = excluded.total_referrals,
  total_mined = excluded.total_mined,
  current_rate = excluded.current_rate,
  session_claimed = excluded.session_claimed;
