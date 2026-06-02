update public.announcements
set is_active = false
where slug = 'satoshi-academy-releases-tyra';

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
  'first-1000-users-in-24-hours',
  '@SatoshiAcademy',
  '1,000 new users joined TYRA in the first 24 hours.',
  'TYRA welcomed 1,000 new users in the first 24 hours of launch. This is only the beginning. Keep mining, keep inviting, and let''s grow the network together from day one.',
  'Invite friends',
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
