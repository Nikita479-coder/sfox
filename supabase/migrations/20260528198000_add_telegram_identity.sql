alter table public.profiles
add column if not exists telegram_user_id text unique,
add column if not exists telegram_username text,
add column if not exists telegram_first_name text,
add column if not exists telegram_last_name text,
add column if not exists telegram_photo_url text,
add column if not exists telegram_language_code text,
add column if not exists telegram_is_premium boolean not null default false;

create unique index if not exists profiles_telegram_user_id_key
on public.profiles (telegram_user_id)
where telegram_user_id is not null;
