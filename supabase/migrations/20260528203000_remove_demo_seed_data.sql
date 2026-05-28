delete from public.referrals
where referrer_profile_id in (
  select id
  from public.profiles
  where username in (
    'NovaPrime',
    'AtlasForge',
    'LunaGrid',
    'SoraVault',
    'KairoMesh',
    'VegaPulse',
    'NexaFlow',
    'OrionMint'
  )
);

delete from public.profiles
where username in (
  'NovaPrime',
  'AtlasForge',
  'LunaGrid',
  'SoraVault',
  'KairoMesh',
  'VegaPulse',
  'NexaFlow',
  'OrionMint'
);

delete from public.announcements
where slug = 'possible-rate-live';
