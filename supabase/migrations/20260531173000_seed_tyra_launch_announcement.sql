insert into public.announcements (
  slug,
  eyebrow,
  title,
  body,
  primary_cta_label,
  secondary_cta_label,
  primary_cta_target,
  secondary_cta_target,
  is_active,
  published_at
)
values (
  'satoshi-academy-releases-tyra',
  '@SatoshiAcademy',
  'Satoshi Academy is releasing TYRA.',
  'Satoshi Academy is officially launching TYRA as the digital asset powering the Satyra network. This release opens the first phase of community mining, referrals, rank progression, and protocol growth for early supporters.',
  'Read launch',
  'Open mining',
  null,
  null,
  true,
  timezone('utc', now())
)
on conflict (slug) do update
set
  eyebrow = excluded.eyebrow,
  title = excluded.title,
  body = excluded.body,
  primary_cta_label = excluded.primary_cta_label,
  secondary_cta_label = excluded.secondary_cta_label,
  primary_cta_target = excluded.primary_cta_target,
  secondary_cta_target = excluded.secondary_cta_target,
  is_active = true,
  published_at = excluded.published_at;
