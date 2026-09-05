# auto-complete-aged-picklists

Server-side counterpart to the browser-based "Ongoing — auto-complete timer"
in Admin (Super Admin only). Runs once daily at 6 AM IST via pg_cron,
independent of anyone having the app open — see `index.ts` for exactly what
it does and does not close (skips any facility that already has a real
not-found reported).

## Deploy (one-time)

Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
supabase login
supabase link --project-ref kytktvvcbgslwokywmds
supabase functions deploy auto-complete-aged-picklists --no-verify-jwt
```

`--no-verify-jwt` is needed because this is called by pg_cron with a custom
`CRON_SECRET`, not a Supabase user JWT — the function checks that secret
itself (see `index.ts`).

## Set secrets

```bash
supabase secrets set CRON_SECRET=<pick-a-long-random-string>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already available to every
Edge Function automatically — no need to set those yourself.

## Schedule it

Open `CRON.sql` in this folder, replace `REPLACE_WITH_YOUR_CRON_SECRET` with
the exact same value you set above, and run it in Supabase → SQL Editor.

## Test it manually before relying on the schedule

```bash
curl -X POST 'https://kytktvvcbgslwokywmds.supabase.co/functions/v1/auto-complete-aged-picklists' \
  -H "Authorization: Bearer <your CRON_SECRET>"
```

Expect `{"ok":true,"closed":N,"skippedWithNotFound":M,"cutoffDays":D}` — or
`{"ok":true,"message":"Auto-complete timer is off — nothing to do."}` if the
Admin dropdown is still set to Off.

## Turning it off

Set the Admin dropdown back to "Off" (the function checks the same
`app_settings` row the browser sweep does) — no need to unschedule the cron
job itself, it'll just no-op every morning.
