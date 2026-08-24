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
 *   3. For every instructed (gate pass, batch, bin) line, checks whether at
 *      least that quantity was actually picked from that exact bin. Not
 *      found at all = picked from a different bin = FEFO non-compliance.
 *      Over-picking from the correct bin is NOT penalized — only the
 *      instructed quantity ever counts toward "compliant".
 *   4. Writes one row per gate pass into `gatepass_adherence` (see
 *      ../supabase/add_gatepass_adherence_table.sql) — the app's Reports
 *      screen reads straight from that table.
 *
 * Lives in the SAME Apps Script project as ShelfwiseIngest.gs and shares its
 * SUPABASE_URL / SERVICE_KEY script properties — no extra setup for those.
 * Add a separate daily time trigger for checkGatepassAdherence() (~9:15 AM,
 * after the 9 AM Uniware email lands). All names below are GPA_-prefixed to
 * avoid colliding with ShelfwiseIngest.gs's own globals in the same project.
 *
 * Backfilling a past date: add a zero-arg wrapper like
 * checkGatepassAdherence_20Aug() below, calling gpaRun_('2026-08-20'), and
 * run it once from the editor — the latest export email already carries
 * historical rows, so no need to hunt down an older email for this.
 */

var GPA_TARGET_FACILITIES = ['SL Mother Hub', 'SL Ambient', 'SL RX'];
var GPA_EMAIL_QUERY = 'subject:"Export Job Complete - Gatepass All Facility" newer_than:2d';
// CLOSED = fully done. RETURN_AWAITED = the pick itself is done and the item
// is in transit, only the destination-side return confirmation is pending —
// still a completed pick as far as FEFO adherence is concerned. CREATED is
// excluded: nothing has actually been picked yet.
var GPA_COMPLETED_STATUSES = ['CLOSED', 'RETURN_AWAITED'];

function checkGatepassAdherence() {
  return gpaRun_(gpaYesterdayIso_());
}

// Zero-arg wrappers so these are selectable from the Apps Script editor's
// "Run" dropdown (it can't pass arguments) — for backfilling a specific past
// date on demand. Add more the same way for other dates as needed.
function checkGatepassAdherence_20Aug() { return gpaRun_('2026-08-20'); }
function checkGatepassAdherence_21Aug() { return gpaRun_('2026-08-21'); }
function checkGatepassAdherence_22Aug() { return gpaRun_('2026-08-22'); }

function gpaRun_(reportDate) {
  Logger.log('gpaRun_ starting for ' + reportDate);
  var props = PropertiesService.getScriptProperties();
  var SUPABASE_URL = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var SERVICE_KEY = (props.getProperty('SERVICE_KEY') || '').trim();
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SERVICE_KEY in Script Properties.');

  // 1) latest export email -> CSV link (it already carries historical rows,
  // so the same latest export can backfill any recent past date too)
  var threads = GmailApp.search(GPA_EMAIL_QUERY, 0, 5);
  if (!threads.length) { Logger.log('No gatepass export email found.'); return { ok: true, status: 'no_email' }; }
  var msgs = threads[0].getMessages();
  var lastMsg = msgs[msgs.length - 1];
  var body = lastMsg.getPlainBody();
  var m = body.match(/https?:\/\/\S+?\.csv/i);
  if (!m) { Logger.log('No CSV link in email.'); return { ok: true, status: 'no_csv_link' }; }

  var fetchRes = UrlFetchApp.fetch(m[0], { muteHttpExceptions: true });
  var rows = Utilities.parseCsv(fetchRes.getContentText());
  if (!rows.length) { Logger.log('Empty CSV (HTTP ' + fetchRes.getResponseCode() + ').'); return { ok: true, status: 'empty_csv' }; }

  var header = rows[0];
  var col = {};
  ['Gatepass Code', 'Item SkuCode', 'Shelf', 'Quantity', 'Uniware Batch Code', 'Gatepass Item Status', 'From Party', 'Gatepass Updated At'].forEach(function (name) {
    var pos = header.indexOf(name);
    if (pos < 0) throw new Error('Expected column "' + name + '" not found in gatepass export header.');
    col[name] = pos;
  });

  // 2) actual picked qty per (gatepass|batch|bin), and — separately — every
  // actual bin+batch a SKU was picked from within a gate pass (gp|sku), so a
  // breached line can show WHERE the picker actually took the stock from.
  var actualQty = {};
  var actualBySku = {}; // 'gatepass|sku' -> [{bin,batch,qty}]
  var closedGatepassesByFacility = {}; // gatepassCode -> facility
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (GPA_COMPLETED_STATUSES.indexOf(r[col['Gatepass Item Status']]) < 0) continue;
    var facility = r[col['From Party']];
    if (GPA_TARGET_FACILITIES.indexOf(facility) < 0) continue;
    var updatedDate = (r[col['Gatepass Updated At']] || '').slice(0, 10);
    if (updatedDate !== reportDate) continue;

    var gp = r[col['Gatepass Code']];
    var sku = r[col['Item SkuCode']];
    var batch = r[col['Uniware Batch Code']] || '';
    var bin = r[col['Shelf']] || '';
    var qty = parseInt(r[col['Quantity']], 10) || 0;
    var key = gpaKey_(gp, batch, bin);
    actualQty[key] = (actualQty[key] || 0) + qty;
    closedGatepassesByFacility[gp] = facility;

    var skuKey = gp + '|' + sku;
    actualBySku[skuKey] = actualBySku[skuKey] || [];
    actualBySku[skuKey].push({ bin: bin, batch: batch, qty: qty });
  }

  var closedGatepasses = Object.keys(closedGatepassesByFacility);
  Logger.log(closedGatepasses.length + ' gate pass(es) closed on ' + reportDate + ' at target facilities.');
  if (!closedGatepasses.length) return { ok: true, status: 'no_closed_gatepasses', reportDate: reportDate };

  // 3) instructed lines for those exact gate passes, from this app's own tasks
  var tasks = gpaFetchAllTasks_(SUPABASE_URL, SERVICE_KEY);
  Logger.log('Fetched ' + tasks.length + ' task(s) from Supabase.');
  var instructedByGatepass = {}; // gatepassCode -> [{sku,bin,batch,qty}]
  var closedSet = {};
  closedGatepasses.forEach(function (gp) { closedSet[gp] = true; });

  tasks.forEach(function (t) {
    var data = t.data;
    if (!data || !data.facilities) return;
    data.facilities.forEach(function (f) {
      var gp = f.gatePassNo || data.gatePassNo;
      if (!gp || !closedSet[gp]) return;
      if (GPA_TARGET_FACILITIES.indexOf(f.facility) < 0) return;
      instructedByGatepass[gp] = instructedByGatepass[gp] || [];
      (f.lines || []).forEach(function (l) {
        instructedByGatepass[gp].push({ sku: l.sku, name: l.name, bin: l.bin, batch: l.batch, qty: l.qty });
      });
    });
  });

  // 4) score each gate pass and upsert
  var upserts = [];
  var skippedNoInstruction = 0;
  closedGatepasses.forEach(function (gp) {
    var lines = instructedByGatepass[gp];
    if (!lines || !lines.length) { skippedNoInstruction++; return; }

    var instructedTotal = 0, compliantTotal = 0;
    var lineDetail = lines.map(function (l) {
      var key = gpaKey_(gp, l.batch, l.bin);
      var actual = actualQty[key] || 0;
      var compliant = Math.min(actual, l.qty);
      instructedTotal += l.qty;
      compliantTotal += compliant;
      var status = actual === 0 ? 'BIN BREACH' : (actual < l.qty ? 'PARTIAL' : 'OK');
      // Every bin+batch this SKU was actually picked from anywhere in this
      // gate pass — for an OK line this just echoes the instructed bin back;
      // for a BREACH/PARTIAL line it shows where the picker went instead.
      var pickedFrom = (actualBySku[gp + '|' + l.sku] || [])
        .map(function (p) { return p.bin + ' / ' + p.batch + ' (' + p.qty + ')'; })
        .join('; ');
      return {
        sku: l.sku, name: l.name, bin: l.bin, batch: l.batch,
        instructed_qty: l.qty, actual_qty: actual, compliant_qty: compliant, status: status,
        picked_bin_batch: pickedFrom,
      };
    });

    upserts.push({
      gatepass_code: gp,
      facility: closedGatepassesByFacility[gp],
      report_date: reportDate,
      instructed_qty: instructedTotal,
      compliant_qty: compliantTotal,
      adherence_pct: instructedTotal > 0 ? Math.round((compliantTotal / instructedTotal) * 10000) / 100 : 0,
      lines: lineDetail,
    });
  });

  if (skippedNoInstruction > 0) {
    var missingSample = closedGatepasses.filter(function (gp) { return !instructedByGatepass[gp] || !instructedByGatepass[gp].length; }).slice(0, 15);
    Logger.log(skippedNoInstruction + ' closed gate pass(es) had no matching instructed data in `tasks` — skipped. Sample: ' + missingSample.join(', '));
  }
  if (!upserts.length) return { ok: true, status: 'nothing_to_score', reportDate: reportDate };

  for (var b = 0; b < upserts.length; b += 500) {
    var resp = gpaSupa_(SUPABASE_URL, SERVICE_KEY, 'POST', '/rest/v1/gatepass_adherence?on_conflict=gatepass_code,report_date',
      upserts.slice(b, b + 500), { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (resp.getResponseCode() >= 300) throw new Error('Upsert failed ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }
  Logger.log('Scored ' + upserts.length + ' gate pass(es) for ' + reportDate + '.');
  return { ok: true, status: 'scored', reportDate: reportDate, count: upserts.length };
}

function gpaKey_(gatepassCode, batch, bin) {
  return gatepassCode + '|' + batch + '|' + bin;
}

function gpaYesterdayIso_() {
  var d = new Date();
  d.setDate(d.getDate() - 1);
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
}

/** Pages through every row of `tasks` (data + gatePassNo not columns — data is the jsonb blob). */
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
