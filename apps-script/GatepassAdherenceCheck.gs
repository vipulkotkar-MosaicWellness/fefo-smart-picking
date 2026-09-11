/**
 * FEFO Smart Picking — Gate Pass Adherence check (Google Apps Script)
 *
 * Runs on its own daily time trigger, fully unattended — nobody uploads
 * anything. Each morning it:
 *   1. Reads yesterday's "Gatepass All Facility" export email (Uniware),
 *      filtered to CLOSED or RETURN_AWAITED items (the pick itself is done
 *      either way — RETURN_AWAITED just means the destination-side return
 *      confirmation hasn't landed yet) from SL Mother Hub / SL Ambient /
 *      SL RX, updated yesterday.
 *   2. Reads what each of those gate passes was INSTRUCTED to pick, straight
 *      from this app's own `tasks` table in Supabase.
 *   3. Scores every instructed line on ONE question: was the instructed
 *      BATCH picked, in the instructed quantity? Shelf/bin is not scored
 *      here — picking the right batch from a different shelf is still FEFO
 *      compliance (that's the whole point of FEFO: the earliest-expiry
 *      batch went out). See "SCORING RULES" below for the exact logic.
 *   4. Writes one row per gate pass into `gatepass_adherence` (see
 *      ../supabase/add_gatepass_adherence_table.sql) — the app's Reports
 *      screen reads straight from that table.
 *
 * ── SCORING RULES (per instructed line) ─────────────────────────────────
 *   Two outputs: `fefo_breach` ("Yes" | "No") and `reason`.
 *
 *   fefo_breach = "No"  when the instructed batch was picked for that SKU
 *                       (from ANY shelf), in any quantity > 0 — or the SKU
 *                       is on GPA_NON_EXPIRY_SKUS.
 *   fefo_breach = "Yes" when a DIFFERENT batch was picked (none of the
 *                       instructed batch), or nothing was picked.
 *
 *   reason:
 *     "Bin & batch match"            right batch, from the instructed bin, full qty
 *     "Batch match, bin mismatch"    right batch, different shelf, full qty
 *     "Partial pick — correct batch" right batch, but short of the instructed qty
 *     "Non-expiry SKU"               SKU on the hardcoded list — always compliant
 *     "Batch mismatch"               a different batch was picked          (BREACH)
 *     "Not picked"                   nothing picked for this SKU line      (BREACH)
 *
 *   compliant_qty = min(instructed-batch units picked for this SKU across
 *                   all shelves, instructed qty). Non-expiry SKUs always
 *                   score the full instructed qty. Over-picking the right
 *                   batch is capped at instructed (no bonus). A partial
 *                   pick credits ONLY the units actually picked — the
 *                   shortfall stays in the denominator, uncredited (so a
 *                   partial pick still pulls adherence_pct down; "breach:
 *                   No" just means it isn't ALSO flagged a batch violation).
 *
 *   When one gate pass instructs the same SKU+batch on several lines
 *   (different bins), the picked units of that batch are matched at the
 *   SKU+batch level and allocated across those lines, so they're never
 *   counted twice.
 *
 *   Batch identity = Uniware Batch Code (what the picklist instructs, tied
 *   to an expiry date) — never the manufacturer's Vendor Batch No.
 * ───────────────────────────────────────────────────────────────────────
 *
 * Lives in the SAME Apps Script project as ShelfwiseIngest.gs and shares its
 * SUPABASE_URL / SERVICE_KEY script properties — no extra setup for those.
 * Add a separate daily time trigger for checkGatepassAdherence() (~9:15 AM,
 * after the 9 AM Uniware email lands). All names below are GPA_-prefixed to
 * avoid colliding with ShelfwiseIngest.gs's own globals in the same project.
 *
 * Re-scoring history: run backfillAllGatepassAdherence() once from the
 * editor — it re-scores every date already in `gatepass_adherence`, from
 * the current export email (which carries the full history) in a single
 * pass (one CSV download, one tasks fetch), so it stays well inside Apps
 * Script's 6-minute limit.
 */

var GPA_TARGET_FACILITIES = ['SL Mother Hub', 'SL Ambient', 'SL RX'];
var GPA_EMAIL_QUERY_BASE = 'subject:"Export Job Complete - Gatepass All Facility"';
var GPA_EMAIL_QUERY = GPA_EMAIL_QUERY_BASE + ' newer_than:2d';
// CLOSED = fully done. RETURN_AWAITED = the pick itself is done and the item
// is in transit, only the destination-side return confirmation is pending —
// still a completed pick as far as FEFO adherence is concerned. CREATED is
// excluded: nothing has actually been picked yet.
var GPA_COMPLETED_STATUSES = ['CLOSED', 'RETURN_AWAITED'];

// Non-expiry SKUs — accessories, cards, toys, innerwear, manuals, devices.
// These have no batch expiry, so FEFO has nothing to enforce: every line
// for one of these scores as fully compliant (fefo_breach "No", reason
// "Non-expiry SKU"), regardless of what/how much was picked. They stay in
// the totals (denominator) — deliberately not removed — so they can't drag
// the number down but also don't distort the gate-pass counts. Codes must
// match `tasks` line SKUs exactly (Uniware SkuCode). Edit this list to add
// or remove SKUs; no other change needed.
var GPA_NON_EXPIRY_SKUS = [
  'MWMMHRP.2050.AAAA.B0_N', 'MWMMHRP.6286.AAAA.B0_N', 'MWBWHFP.00161.B0_N',
  'MWMMHRP.0012.AAAA.B0_N', 'MWMMHRP.0009.AAAA.B0_N', 'MWBWHFP.00225.B0_N',
  'MWMMHRP.0018.AAAA.B0_N', 'MWBWSKP.00226.B0_N', 'MWBWPCP.00001.B0_N',
  'MWMMHKC.00002.AAAA.B0_N', 'MWLJGNP.00022.B0_N', 'MWLJGCP.0005.B0_N',
  'MWLJGCP.0006.B0_N', 'MWLJGCP.0007.B0_N', 'MWLJGNP.00011.B0_N',
  'MWLJGNP.00012.B0_N', 'MWLJGNP.00016.B0_N', 'MWLJGNP.0002.B0_N',
  'MWLJGNP.00023.B0_N', 'MWLJGNP.00026.B0_N', 'MWLJGNP.00027.B0_N',
  'MWLJGNP.00028.B0_N', 'MWLJGNP.00029.B0_N', 'MWLJGNP.00030.B0_N',
  'MWLJGNP.00031.B0_N', 'MWLJGNP.00040.B0_N', 'MWLJGNP.00041.B0_N',
  'MWLJGNP.00051.B0_N', 'MWLJGNP.00052.B0_N', 'MWLJGNP.00053.B0_N',
  'MWLJGNP.00056.B0_N', 'MWLJGNP.00059.B0_N', 'MWLJGNP.00068.B0_N',
  'MWLJGNP.00071.B0_N', 'MWLJPCP.00010.B0_N', 'MWLJPCP.00011.B0_N',
  'MWLJPCP.0006.B0_N', 'MWLJPCP.0007.B0_N', 'MWLJPCP.0008.B0_N',
  'MWLJPCP.0009.B0_N', 'MWLJPCP.00016.B0_N', 'MWMMHKC.00001.AAAA.B0_N',
  'MWMMHTP.1003.AAAA.B0_N', 'MWMMHTP.1005.AAAA.B0_N', 'MWMMHTP.1007.AAAA.B0_N',
  'MWMMHTP.1008.AAAA.B0_N', 'MWMMHTP.1011.AAAA.B0_N', 'MWMMHTP.1012.AAAA.B0_N',
  'MWMMHTP.1017.AAAA.B0_N', 'MWMMHTP.1018.AAAA.B0_N', 'MWMMHTP.1023.AAAA.B0_N',
  'MWMMHTP.1024.AAAA.B0_N',
];
var GPA_NON_EXPIRY_SET = (function () {
  var s = {};
  GPA_NON_EXPIRY_SKUS.forEach(function (x) { s[x] = true; });
  return s;
})();

/** Daily entry point — scores yesterday. Wire the time trigger to this. */
function checkGatepassAdherence() {
  var ctx = gpaLoadContext_();
  if (ctx.error) return ctx.error;
  var res = gpaScoreDates_(ctx, [gpaYesterdayIso_()]);
  return res.perDate[gpaYesterdayIso_()] || { ok: true, status: 'nothing_to_score', reportDate: gpaYesterdayIso_() };
}

/**
 * Re-scores EVERY date already present in `gatepass_adherence`, using the
 * new rules, from the current export email. Run once from the editor after
 * deploying a scoring-logic change. Single CSV download + single tasks
 * fetch, so it comfortably handles a few dozen dates within the 6-min limit.
 */
function backfillAllGatepassAdherence() {
  var ctx = gpaLoadContext_();
  if (ctx.error) return ctx.error;

  var resp = gpaSupa_(ctx.url, ctx.key, 'GET',
    '/rest/v1/gatepass_adherence?select=report_date&order=report_date.asc&limit=1');
  if (resp.getResponseCode() >= 300) throw new Error('Could not read earliest report_date: ' + resp.getContentText());
  var arr = JSON.parse(resp.getContentText());
  if (!arr.length) { Logger.log('gatepass_adherence is empty — nothing to backfill.'); return { ok: true, dates: [] }; }

  var dates = gpaDateRange_(arr[0].report_date, gpaYesterdayIso_());
  Logger.log('Backfilling ' + dates.length + ' date(s): ' + dates[0] + ' .. ' + dates[dates.length - 1]);
  var res = gpaScoreDates_(ctx, dates);
  Logger.log('Backfill done. ' + JSON.stringify(res.summary));
  return res;
}

/** Backfill a single explicit date (e.g. one that failed in the bulk run). */
function backfillGatepassAdherenceDate(reportDate) {
  var ctx = gpaLoadContext_();
  if (ctx.error) return ctx.error;
  return gpaScoreDates_(ctx, [reportDate]);
}

/**
 * Diagnostic — tallies every line in `gatepass_adherence` by `reason`, so
 * you can see the actual mix (bin & batch match / shelf mismatch / partial
 * / wrong batch / not picked / non-expiry) instead of just the headline %.
 * Useful right after a backfill to sanity-check the new scoring is doing
 * what's expected — in particular, that "Batch match, bin mismatch" is a
 * real, non-trivial bucket (that's the shelf-only carve-out actually firing).
 * Pass a report_date to scope to one day, or omit for everything scored.
 */
function diagAdherenceReasonBreakdown(reportDate) {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var key = (props.getProperty('SERVICE_KEY') || '').trim();
  var path = '/rest/v1/gatepass_adherence?select=report_date,lines' + (reportDate ? '&report_date=eq.' + reportDate : '');
  var rows = [];
  var offset = 0, pageSize = 1000;
  while (true) {
    var resp = gpaSupa_(url, key, 'GET', path, null, { Range: offset + '-' + (offset + pageSize - 1) });
    if (resp.getResponseCode() >= 300) throw new Error('Fetch failed ' + resp.getResponseCode() + ': ' + resp.getContentText());
    var page = JSON.parse(resp.getContentText());
    rows = rows.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  var byReason = {}; // reason -> {lines, instructed, compliant}
  var oldShapeLines = 0, newShapeLines = 0;
  rows.forEach(function (r) {
    (r.lines || []).forEach(function (l) {
      var isNewShape = !!l.reason;
      if (isNewShape) newShapeLines++; else oldShapeLines++;
      var reason = isNewShape ? l.reason : (l.status === 'OK' ? 'Bin & batch match (old-shape row)' : l.status === 'PARTIAL' ? 'Partial pick (old-shape row)' : 'Batch/bin mismatch (old-shape row)');
      var b = byReason[reason] || (byReason[reason] = { lines: 0, instructed: 0, compliant: 0 });
      b.lines++;
      b.instructed += l.instructed_qty || 0;
      b.compliant += l.compliant_qty || 0;
    });
  });

  var summary = Object.keys(byReason).sort(function (a, b) { return byReason[b].instructed - byReason[a].instructed; }).map(function (reason) {
    var b = byReason[reason];
    return reason + ': ' + b.lines + ' lines, ' + b.instructed + ' instructed units, ' + b.compliant + ' compliant units';
  });
  Logger.log('Rows: ' + rows.length + ' (' + newShapeLines + ' lines new-shape, ' + oldShapeLines + ' lines old-shape)\n' + summary.join('\n'));
  return { rowCount: rows.length, newShapeLines: newShapeLines, oldShapeLines: oldShapeLines, byReason: byReason };
}

// ── Load-once context (export CSV + tasks) ────────────────────────────

function gpaLoadContext_() {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var key = (props.getProperty('SERVICE_KEY') || '').trim();
  if (!url || !key) throw new Error('Set SUPABASE_URL and SERVICE_KEY in Script Properties.');

  var threads = GmailApp.search(GPA_EMAIL_QUERY, 0, 5);
  if (!threads.length) { Logger.log('No gatepass export email found.'); return { error: { ok: true, status: 'no_email' } }; }
  var msgs = threads[0].getMessages();
  var body = msgs[msgs.length - 1].getPlainBody();
  var m = body.match(/https?:\/\/\S+?\.csv/i);
  if (!m) { Logger.log('No CSV link in email.'); return { error: { ok: true, status: 'no_csv_link' } }; }

  var fetchRes = UrlFetchApp.fetch(m[0], { muteHttpExceptions: true });
  var parsed = gpaParseCsvText_(fetchRes.getContentText());
  if (!parsed) { Logger.log('Empty CSV (HTTP ' + fetchRes.getResponseCode() + ').'); return { error: { ok: true, status: 'empty_csv' } }; }

  var tasks = gpaFetchAllTasks_(url, key);
  Logger.log('Loaded ' + (parsed.rows.length - 1) + ' export rows, ' + tasks.length + ' tasks.');
  return { url: url, key: key, csvRows: parsed.rows, col: parsed.col, tasks: tasks };
}

/** Parses one export CSV's text into {rows, col} — shared by gpaLoadContext_ and the archive backfill below. */
function gpaParseCsvText_(text) {
  var rows = Utilities.parseCsv(text);
  if (!rows.length) return null;
  var header = rows[0];
  var col = {};
  ['Gatepass Code', 'Item SkuCode', 'Shelf', 'Quantity', 'Uniware Batch Code', 'Vendor Batch No', 'Gatepass Item Status', 'From Party', 'Gatepass Updated At'].forEach(function (name) {
    var pos = header.indexOf(name);
    if (pos < 0) throw new Error('Expected column "' + name + '" not found in gatepass export header.');
    col[name] = pos;
  });
  return { rows: rows, col: col };
}

/**
 * Re-scores dates the LATEST export can't reach — its CSV only carries a
 * rolling window of recent history, so a date backfillAllGatepassAdherence()
 * reports as "noData" has simply aged out of it. This instead fetches the
 * archived export email closest to (on or shortly after) each date — one
 * gets sent daily, so there's usually one sitting in Gmail from right
 * around any past date — and scores from THAT CSV instead.
 *
 * Pass an array of 'yyyy-MM-dd' strings, e.g.:
 *   backfillGatepassAdherenceFromArchive(['2026-08-20','2026-08-23'])
 */
function backfillGatepassAdherenceFromArchive(reportDates) {
  var props = PropertiesService.getScriptProperties();
  var url = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var key = (props.getProperty('SERVICE_KEY') || '').trim();
  if (!url || !key) throw new Error('Set SUPABASE_URL and SERVICE_KEY in Script Properties.');

  var tasks = gpaFetchAllTasks_(url, key);
  var results = {};
  reportDates.forEach(function (reportDate) {
    var found = gpaFindArchivedCsv_(reportDate);
    if (!found) { results[reportDate] = { ok: false, status: 'no_export_email_found_nearby' }; Logger.log(reportDate + ': no export email found nearby — skipped.'); return; }
    var parsed = gpaParseCsvText_(found.csvText);
    if (!parsed) { results[reportDate] = { ok: false, status: 'empty_csv' }; Logger.log(reportDate + ': found an export (dated ' + found.usedMessageDate + ') but its CSV was empty.'); return; }
    var ctx = { url: url, key: key, csvRows: parsed.rows, col: parsed.col, tasks: tasks };
    var res = gpaScoreDates_(ctx, [reportDate]);
    results[reportDate] = res.perDate[reportDate];
    Logger.log(reportDate + ' (from export dated ' + found.usedMessageDate + '): ' + JSON.stringify(results[reportDate]));
  });
  return results;
}

/** The 6 dates backfillAllGatepassAdherence() couldn't reach on 2026-09-11 — convenience wrapper, no args needed from the Run dropdown. */
function backfillTheSixMissingDates() {
  return backfillGatepassAdherenceFromArchive(['2026-08-20', '2026-08-23', '2026-08-24', '2026-08-25', '2026-08-30', '2026-09-02']);
}

/**
 * Every export email matching the subject, flattened across threads and
 * sorted ascending by date — cached for the life of one execution, so
 * backfillGatepassAdherenceFromArchive() only searches Gmail once no
 * matter how many dates it's asked to cover.
 *
 * Deliberately does NOT use Gmail's after:/before: search operators: a
 * date-bounded GmailApp.search() query returned zero threads here even
 * though the exact same query string returns real results through the
 * Gmail API directly — some Apps Script / GmailApp-specific quirk with
 * combining after:+before: with a quoted subject, not a bad query. This
 * searches by subject only (matches the plain single-operator query that
 * already works fine elsewhere in this file) and filters by date in JS.
 */
var gpaArchiveMessagesCache_ = null;
function gpaAllArchiveMessages_() {
  if (gpaArchiveMessagesCache_) return gpaArchiveMessagesCache_;
  var threads = GmailApp.search(GPA_EMAIL_QUERY_BASE, 0, 80);
  var messages = [];
  threads.forEach(function (t) { t.getMessages().forEach(function (m) { messages.push(m); }); });
  messages.sort(function (a, b) { return a.getDate().getTime() - b.getDate().getTime(); });
  Logger.log('Archive search: ' + threads.length + ' thread(s), ' + messages.length + ' message(s)'
    + (messages.length ? ', spanning ' + messages[0].getDate() + ' .. ' + messages[messages.length - 1].getDate() : ''));
  gpaArchiveMessagesCache_ = messages;
  return messages;
}

/**
 * Finds the export email generated soonest ON OR AFTER reportDate (within a
 * few days) and downloads its CSV. Picking the EARLIEST available export
 * after the date — rather than the latest overall — maximizes the chance
 * that date is still inside that export's own lookback window.
 */
function gpaFindArchivedCsv_(reportDate) {
  var start = new Date(reportDate + 'T00:00:00Z');
  var searchEnd = new Date(start.getTime() + 4 * 24 * 60 * 60 * 1000);
  var messages = gpaAllArchiveMessages_(); // pre-sorted ascending by date
  var msg = null;
  for (var i = 0; i < messages.length; i++) {
    var t = messages[i].getDate().getTime();
    if (t >= start.getTime() && t < searchEnd.getTime()) { msg = messages[i]; break; }
  }
  if (!msg) return null;
  var body = msg.getPlainBody();
  var m2 = body.match(/https?:\/\/\S+?\.csv/i);
  if (!m2) return null;
  var res = UrlFetchApp.fetch(m2[0], { muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return null;
  return { csvText: res.getContentText(), usedMessageDate: msg.getDate() };
}

// ── Scoring ──────────────────────────────────────────────────────────

/**
 * Scores each of `reportDates` off the already-loaded context and upserts
 * every resulting gate-pass row in one batched write. Returns per-date
 * outcomes plus a roll-up summary.
 */
function gpaScoreDates_(ctx, reportDates) {
  var wanted = {};
  reportDates.forEach(function (d) { wanted[d] = true; });

  // Per-date actual-pick maps, built in a single pass over the export.
  //   bySkuBatch:    date -> 'gp|sku|batch'      -> qty (any shelf)
  //   bySkuBatchBin: date -> 'gp|sku|batch|bin'  -> qty (for the bin-match flag)
  //   bySku:         date -> 'gp|sku'            -> [{bin,batch,qty,vendorBatch}]
  //   gpFacility:    date -> gp -> facility
  var byDate = {};
  var rows = ctx.csvRows, col = ctx.col;
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (GPA_COMPLETED_STATUSES.indexOf(r[col['Gatepass Item Status']]) < 0) continue;
    var facility = r[col['From Party']];
    if (GPA_TARGET_FACILITIES.indexOf(facility) < 0) continue;
    var date = (r[col['Gatepass Updated At']] || '').slice(0, 10);
    if (!wanted[date]) continue;

    var d = byDate[date] || (byDate[date] = { bySkuBatch: {}, bySkuBatchBin: {}, bySku: {}, gpFacility: {} });
    var gp = r[col['Gatepass Code']];
    var sku = r[col['Item SkuCode']];
    var batch = r[col['Uniware Batch Code']] || '';
    var bin = r[col['Shelf']] || '';
    var qty = parseInt(r[col['Quantity']], 10) || 0;

    d.bySkuBatch[gp + '|' + sku + '|' + batch] = (d.bySkuBatch[gp + '|' + sku + '|' + batch] || 0) + qty;
    d.bySkuBatchBin[gp + '|' + sku + '|' + batch + '|' + bin] = (d.bySkuBatchBin[gp + '|' + sku + '|' + batch + '|' + bin] || 0) + qty;
    (d.bySku[gp + '|' + sku] || (d.bySku[gp + '|' + sku] = [])).push({ bin: bin, batch: batch, qty: qty, vendorBatch: r[col['Vendor Batch No']] || '' });
    d.gpFacility[gp] = facility;
  }

  var allUpserts = [];
  var perDate = {};
  var summary = { dates: 0, gatePasses: 0, instructed: 0, compliant: 0, skippedNoInstruction: 0, noData: [] };

  reportDates.forEach(function (reportDate) {
    var d = byDate[reportDate];
    var closed = d ? Object.keys(d.gpFacility) : [];
    if (!closed.length) {
      perDate[reportDate] = { ok: true, status: 'no_closed_gatepasses', reportDate: reportDate };
      summary.noData.push(reportDate);
      return;
    }

    var closedSet = {};
    closed.forEach(function (gp) { closedSet[gp] = true; });
    var instructedByGatepass = {};
    ctx.tasks.forEach(function (t) {
      var data = t.data;
      if (!data || !data.facilities) return;
      data.facilities.forEach(function (f) {
        var gp = f.gatePassNo || data.gatePassNo;
        if (!gp || !closedSet[gp]) return;
        if (GPA_TARGET_FACILITIES.indexOf(f.facility) < 0) return;
        var arr = instructedByGatepass[gp] || (instructedByGatepass[gp] = []);
        (f.lines || []).forEach(function (l) {
          arr.push({ sku: l.sku, name: l.name, bin: l.bin, batch: l.batch, qty: l.qty });
        });
      });
    });

    var upserts = [];
    var skippedNoInstruction = 0;
    closed.forEach(function (gp) {
      var lines = instructedByGatepass[gp];
      if (!lines || !lines.length) { skippedNoInstruction++; return; }
      var scored = gpaScoreGatePass_(gp, lines, d);
      upserts.push({
        gatepass_code: gp,
        facility: d.gpFacility[gp],
        report_date: reportDate,
        instructed_qty: scored.instructedTotal,
        compliant_qty: scored.compliantTotal,
        adherence_pct: scored.instructedTotal > 0 ? Math.round((scored.compliantTotal / scored.instructedTotal) * 10000) / 100 : 0,
        lines: scored.lineDetail,
      });
    });

    summary.dates++;
    summary.gatePasses += upserts.length;
    summary.skippedNoInstruction += skippedNoInstruction;
    upserts.forEach(function (u) { summary.instructed += u.instructed_qty; summary.compliant += u.compliant_qty; });
    allUpserts = allUpserts.concat(upserts);
    perDate[reportDate] = { ok: true, status: upserts.length ? 'scored' : 'nothing_to_score', reportDate: reportDate, count: upserts.length, skippedNoInstruction: skippedNoInstruction };
  });

  for (var b = 0; b < allUpserts.length; b += 500) {
    var resp = gpaSupa_(ctx.url, ctx.key, 'POST', '/rest/v1/gatepass_adherence?on_conflict=gatepass_code,report_date',
      allUpserts.slice(b, b + 500), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (resp.getResponseCode() >= 300) throw new Error('Upsert failed ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  summary.overallPct = summary.instructed > 0 ? Math.round((summary.compliant / summary.instructed) * 10000) / 100 : 0;
  Logger.log('Scored ' + summary.gatePasses + ' gate pass(es) across ' + summary.dates + ' date(s). Overall ' + summary.overallPct + '%.');
  return { ok: true, perDate: perDate, summary: summary };
}

/** Scores every instructed line of one gate pass. See SCORING RULES in the file header. */
function gpaScoreGatePass_(gp, lines, d) {
  // Group instructed lines by sku|batch so a batch's picked units are
  // allocated across its lines once (no double count).
  var groups = {};
  lines.forEach(function (l) {
    var k = l.sku + '|' + l.batch;
    (groups[k] || (groups[k] = [])).push(l);
  });

  var lineDetail = [];
  var instructedTotal = 0, compliantTotal = 0;

  Object.keys(groups).forEach(function (k) {
    var groupLines = groups[k];
    var sku = groupLines[0].sku;
    var batch = groupLines[0].batch;
    var nonExpiry = GPA_NON_EXPIRY_SET[sku] === true;

    var actualEntries = d.bySku[gp + '|' + sku] || [];
    var anyPicked = actualEntries.reduce(function (s, p) { return s + p.qty; }, 0);
    var correctBatchPicked = d.bySkuBatch[gp + '|' + sku + '|' + batch] || 0;
    var remaining = correctBatchPicked; // pool allocated across this group's lines

    var pickedFrom = actualEntries
      .map(function (p) { return p.bin + ' / ' + p.batch + ' (' + p.qty + ')'; })
      .join('; ');
    var vendorSeen = {};
    var vendorList = [];
    actualEntries.forEach(function (p) {
      if (p.vendorBatch && !vendorSeen[p.vendorBatch]) { vendorSeen[p.vendorBatch] = true; vendorList.push(p.vendorBatch); }
    });
    var vendorBatch = vendorList.join('; ');

    groupLines.forEach(function (l) {
      instructedTotal += l.qty;
      var binMatch = (d.bySkuBatchBin[gp + '|' + sku + '|' + batch + '|' + l.bin] || 0) > 0 ? 'Yes' : 'No';
      var compliant, breach, reason, actualForLine;

      if (nonExpiry) {
        compliant = l.qty;
        breach = 'No';
        reason = 'Non-expiry SKU';
        actualForLine = anyPicked;
      } else if (correctBatchPicked === 0) {
        compliant = 0;
        breach = 'Yes';
        reason = anyPicked > 0 ? 'Batch mismatch' : 'Not picked';
        actualForLine = 0;
      } else {
        var alloc = Math.min(l.qty, remaining);
        remaining -= alloc;
        compliant = alloc;
        breach = 'No';
        actualForLine = correctBatchPicked;
        if (alloc < l.qty) reason = 'Partial pick — correct batch';
        else if (binMatch === 'Yes') reason = 'Bin & batch match';
        else reason = 'Batch match, bin mismatch';
      }

      compliantTotal += compliant;
      lineDetail.push({
        sku: l.sku, name: l.name, bin: l.bin, batch: l.batch,
        instructed_qty: l.qty, actual_qty: actualForLine, compliant_qty: compliant,
        fefo_breach: breach, reason: reason, bin_match: binMatch,
        picked_bin_batch: pickedFrom, vendor_batch: vendorBatch,
      });
    });
  });

  return { instructedTotal: instructedTotal, compliantTotal: compliantTotal, lineDetail: lineDetail };
}

// ── Helpers ──────────────────────────────────────────────────────────

function gpaYesterdayIso_() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
}

/** Inclusive list of 'yyyy-MM-dd' strings from startIso to endIso. */
function gpaDateRange_(startIso, endIso) {
  var out = [];
  var cur = new Date(startIso + 'T00:00:00Z');
  var end = new Date(endIso + 'T00:00:00Z');
  while (cur <= end) {
    out.push(Utilities.formatDate(cur, 'UTC', 'yyyy-MM-dd'));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Pages through every row of `tasks` (data is the jsonb blob, not columns). */
function gpaFetchAllTasks_(url, key) {
  var out = [];
  var offset = 0;
  var pageSize = 1000;
  while (true) {
    var resp = gpaSupa_(url, key, 'GET', '/rest/v1/tasks?select=data', null, { Range: offset + '-' + (offset + pageSize - 1) });
    if (resp.getResponseCode() >= 300) throw new Error('Fetch tasks failed ' + resp.getResponseCode() + ': ' + resp.getContentText());
    var page = JSON.parse(resp.getContentText());
    out = out.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

function gpaSupa_(url, key, method, path, payload, extraHeaders) {
  var headers = { apikey: key, Authorization: 'Bearer ' + key };
  for (var h in extraHeaders) headers[h] = extraHeaders[h];
  var opt = { method: method, headers: headers, contentType: 'application/json', muteHttpExceptions: true };
  if (payload) opt.payload = JSON.stringify(payload);
  return UrlFetchApp.fetch(url + path, opt);
}
