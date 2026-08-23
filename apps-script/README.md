# Live inventory feed — setup (Phase B)

This connects your **Shelfwise inventory email → Supabase → the app**, refreshed hourly.

**Your Supabase project:** `kytktvvcbgslwokywmds`
**API URL:** `https://kytktvvcbgslwokywmds.supabase.co`

---

## Step 1 — Create the database tables
1. Supabase dashboard → **SQL Editor** → **New query**.
2. Paste the contents of [`../supabase/schema.sql`](../supabase/schema.sql) → **Run**.
3. You should see the `stock` and `sync_state` tables under **Table Editor**.

## Step 2 — Get your keys (Settings → API)
- **Project URL:** `https://kytktvvcbgslwokywmds.supabase.co`
- **`service_role` key** — SECRET. Used only in the Apps Script below. **Never put it in the app or share it.**
- **`anon` key** — public. Used later by the web app to *read* stock.

## Step 3 — Set up the hourly email reader (Google Apps Script)
1. Go to **script.google.com** → **New project**.
2. Delete the sample code, paste in [`ShelfwiseIngest.gs`](ShelfwiseIngest.gs).
3. **Project Settings** (gear) → **Script Properties** → **Add**:
   - `SUPABASE_URL` = `https://kytktvvcbgslwokywmds.supabase.co`
   - `SERVICE_KEY` = *(your service_role key)*
4. Back in the editor, select function **`ingest`** → **Run**. Approve the Gmail permission prompt (it needs to read the export email).
5. Check **Executions** — it should log `Done — NNNN rows synced`, and Supabase → Table Editor → `stock` should now hold your rows.
6. **Triggers** (clock icon, left) → **Add Trigger**:
   - Function: `ingest` · Event source: **Time-driven** · Type: **Hour timer** · **Every hour**.

That's it — the feed now refreshes every hour, and skips refreshing while any picking is still open (the freeze rule).

---

## Step 4 (I do this) — point the web app at Supabase
Once `stock` is populated, add the **anon key** to the app and it reads live inventory:
- Local: copy `.env.example` → `.env`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- Vercel: Project → Settings → Environment Variables → add the same two.

Tell me when Step 1–3 are done (and share the **anon** key — it's public/safe), and I'll wire the app to read from Supabase.

---

## Step 5 — Gate pass adherence check (daily, unattended)

Compares every gate pass closed yesterday at SL Mother Hub / SL Ambient / SL RX against what
this app instructed it to pick — no file upload, runs entirely on its own schedule.

1. Run [`../supabase/add_gatepass_adherence_table.sql`](../supabase/add_gatepass_adherence_table.sql)
   in the Supabase SQL Editor (same project as above).
2. In the **same** Apps Script project from Step 3 — **File → New → Script file**, name it
   `GatepassAdherenceCheck`, paste in [`GatepassAdherenceCheck.gs`](GatepassAdherenceCheck.gs).
   It reuses the `SUPABASE_URL` / `SERVICE_KEY` script properties already set — nothing new to add there.
3. Select function **`checkGatepassAdherence`** → **Run**. Approve the Gmail prompt if asked again.
   Check **Executions** — it should log something like `Scored N gate pass(es) for 2026-08-22`.
4. **Triggers** → **Add Trigger**:
   - Function: `checkGatepassAdherence` · Event source: **Time-driven** · Type: **Day timer** ·
     time of day **9am to 10am** (after your 9 AM "Gatepass All Facility" email lands).

That's it — results show up under **Reports → Gate Pass Adherence** in the app the next time it loads.
