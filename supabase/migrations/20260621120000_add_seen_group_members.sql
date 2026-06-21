create table if not exists public.telegram_group_members (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null,
  telegram_user_id text not null,
  username text,
  first_name text,
  last_seen_at timestamptz not null default timezone('utc', now()),
  tagged_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (chat_id, telegram_user_id)
);

alter table public.telegram_group_members enable row level security;

drop trigger if exists telegram_group_members_updated_at on public.telegram_group_members;
create trigger telegram_group_members_updated_at
before update on public.telegram_group_members
for each row execute procedure public.handle_updated_at();

revoke all on public.telegram_group_members from anon, authenticated;
