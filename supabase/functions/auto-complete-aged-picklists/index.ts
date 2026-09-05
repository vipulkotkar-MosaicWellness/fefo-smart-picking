// Scheduled Edge Function — auto-closes WMS-blocked picklists once they've
// aged past the Super-Admin-configured `auto_complete_after_days` setting
// (see app_settings / AdminConfig.tsx "Ongoing — auto-complete timer").
//
// Why this exists as a server-side function and not just the existing
// browser-side sweep (checkPicklistAutoComplete in store.ts): that sweep
// only runs while someone has the app open, checking every 60 seconds — no
// guaranteed run time. This function is meant to be triggered by a daily
// pg_cron schedule (06:00 IST = 00:30 UTC) so the close happens on a fixed
// clock regardless of who has a browser open. See CRON.sql in this folder
// for the schedule, and README.md for deployment steps.
//
// Deliberately narrower than the browser-side closeAgedWmsBlockedPicklists:
// that one reuses the full applyPicks(), which — when a facility already
// has some genuine not-found lines (bad > 0) — re-offers that shortfall as
// a round-2 picklist against current stock, complete with hold creation and
// gate-pass-conflict checks. Reimplementing that full allocation engine
// here, server-side, would duplicate a large and actively-changing part of
// store.ts. Instead: a facility is only auto-closed here if EVERY currently
// unresolved line can simply be backfilled to "fully picked, 0 not found"
// (i.e. it would complete with bad === 0). Any facility that already has a
// real not-found reported is left alone — it's visible in the Supervisor
// queue's "Not found — needs an alternate" bucket already, and the existing
// one-time cleanup in Admin (full applyPicks fidelity) handles it correctly
// if a human runs it.

import { createClient } from "npm:@supabase/supabase-js@2";

interface PickLine {
  rid: number;
  qty: number;
  picked?: number | null;
  nf?: number | null;
}

interface FacilityPicklist {
  no: string;
  taskNo: string;
  status: string;
  bad: number;
  lines: PickLine[];
  wmsBlocked?: boolean;
  createdAt?: string;
  pickedTotal?: number;
  completedAt?: string;
}

interface PickingTask {
  no: string;
  createdAt: string;
  facilities: FacilityPicklist[];
}

Deno.serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const expected = `Bearer ${Deno.env.get("CRON_SECRET") ?? ""}`;
  if (!Deno.env.get("CRON_SECRET") || authHeader !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: setting, error: settingError } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "auto_complete_after_days")
    .maybeSingle();
  if (settingError) return json({ error: settingError.message }, 500);

  const days = typeof setting?.value === "number" ? setting.value : null;
  if (days == null) return json({ ok: true, message: "Auto-complete timer is off — nothing to do." });

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const { data: rows, error: tasksError } = await supabase.from("tasks").select("no,data");
  if (tasksError) return json({ error: tasksError.message }, 500);

  let closed = 0;
  let skippedWithNotFound = 0;
  const now = new Date().toISOString();

  for (const row of rows ?? []) {
    const task = row.data as PickingTask;
    let changed = false;

    for (const f of task.facilities) {
      if (f.status === "completed" || !f.wmsBlocked) continue;
      const createdAt = f.createdAt ?? task.createdAt;
      if (!createdAt || new Date(createdAt).getTime() > cutoffMs) continue;

      // Preview what `bad` would be after backfilling every unresolved
      // line to "found, 0 not found" — skip entirely if any line already
      // has a real not-found qty (see module comment above).
      const projectedBad = f.lines.reduce((sum, l) => sum + (l.picked != null ? l.nf ?? 0 : 0), 0);
      if (projectedBad > 0) {
        skippedWithNotFound++;
        continue;
      }

      for (const l of f.lines) {
        if (l.picked == null) {
          l.picked = l.qty;
          l.nf = 0;
        }
      }
      f.status = "completed";
      f.bad = 0;
      f.pickedTotal = f.lines.reduce((sum, l) => sum + (l.picked ?? 0), 0);
      f.completedAt = now;
      changed = true;
      closed++;
    }

    if (changed) {
      const { error: updateError } = await supabase.from("tasks").update({ data: task }).eq("no", task.no);
      if (updateError) return json({ error: updateError.message, partiallyApplied: true, closedBeforeError: closed }, 500);
    }
  }

  return json({ ok: true, closed, skippedWithNotFound, cutoffDays: days });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
