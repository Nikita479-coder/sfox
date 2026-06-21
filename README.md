# satyra

## Telegram group import

To import existing Telegram group members into Supabase so `/synctag` can tag them in bulk:

1. Add these values to `.env`:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `TELEGRAM_API_ID`
   - `TELEGRAM_API_HASH`
   - optionally `TELEGRAM_IMPORT_TARGETS=@groupusername,-1001234567890`
2. Run:
   - `npm.cmd run telegram:import-group`
3. On first run, sign in with the Telegram user account that can see the group members.
4. After the import finishes, run `/synctag` in the target group as an admin.

The importer stores a local Telegram session in `.telegram-session`, which is ignored by git.
