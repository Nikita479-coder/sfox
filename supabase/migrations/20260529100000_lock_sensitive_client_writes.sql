drop policy if exists "public can manage demo profiles by username" on public.profiles;
drop policy if exists "public can manage referrals" on public.referrals;
drop policy if exists "public can manage supply events" on public.supply_events;
drop policy if exists "public can manage mining claims" on public.mining_claims;

drop policy if exists "public can write announcements" on public.announcements;

revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.referrals from anon, authenticated;
revoke insert, update, delete on public.announcements from anon, authenticated;
revoke insert, update, delete on public.supply_events from anon, authenticated;
revoke insert, update, delete on public.mining_claims from anon, authenticated;
