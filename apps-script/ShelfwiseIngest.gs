/**
 * FEFO Smart Picking — Shelfwise inventory ingestion (Google Apps Script)
 * Reads the export email hourly, downloads the CSV, filters to the 3 facilities
 * (Good + Active, qty>0) and pushes to Supabase. See apps-script/README.md.
 *
 * SETUP: Script Properties →  SUPABASE_URL = https://kytktvvcbgslwokywmds.supabase.co
 *                             SERVICE_KEY  = <SECRET service_role / sb_secret key>
 *                             TRIGGER_TOKEN = <any random string you make up>
 * Then run `ingest` and add an hourly time-driven trigger.
 *
 * Columns are read BY NAME (not position) — the export report has changed its
 * column layout before (extra columns inserted mid-row) and silently broke a
 * positional parser. A header-name lookup survives that; it only fails loudly
 * if a column we actually need disappears entirely.
 *
 * ON-DEMAND TRIGGER (doGet): "Sync now" in the app doesn't wait for the
 * hourly clock — it calls this deployed Web App URL directly, which runs the
 * exact same ingest() used by the hourly trigger (same feed_frozen check,
 * same everything). Gated by TRIGGER_TOKEN so a random visitor can't spam it;
 * the app is configured with the token baked into the URL it calls, the same
 * way it already carries a public Supabase anon key — not a secret in the
 * strict sense, just enough to keep this off search engines / random hits.
 * Deploy: Deploy → New deployment → type "Web app" → Execute as "Me" →
 * Who has access "Anyone" → copy the /exec URL, append "?token=<your TRIGGER_TOKEN>",
 * and put that full URL in the app's VITE_INGEST_TRIGGER_URL setting.
 */

var INGEST_VERSION = 'v6-per-facility-freeze';
var TARGET_FACILITIES = ['SL Mother Hub', 'SL Ambient', 'SL RX'];
var EMAIL_QUERY = 'subject:"Export Job Complete - Shelfwise Inventory" newer_than:2d';

// CSV header name -> the field we use it for.
var COLUMNS = {
  facility: 'Facility',
  sku: 'Item Type SKU Code',
  name: 'Item Type Name',
  invType: 'Inventory Type',
  bin: 'Shelf',
  qty: 'Quantity',
  batch: 'Batch Code',
  expiry: 'Expiry',
  mfg: 'Manufacturing',
  status: 'Batch Status',
};

// Optional — not every export variant carries this column, so a missing one
// just means vendor_batch stays null rather than failing the whole ingest.
var VENDOR_BATCH_COLUMN = 'Vendor batch code';

/**
 * Runs the sync. Always returns a status object instead of relying only on
 * logs, so both the hourly trigger (which ignores the return value) and the
 * on-demand doGet() caller (which reports it back to the browser) can share
 * this one function with no duplicated logic or duplicated feed_frozen check.
 */
function ingest() {
  Logger.log('ingest ' + INGEST_VERSION + ' starting');
  var props = PropertiesService.getScriptProperties();
  var SUPABASE_URL = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var SERVICE_KEY = (props.getProperty('SERVICE_KEY') || '').trim();
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SERVICE_KEY in Script Properties.');
  if (SERVICE_KEY.indexOf('sb_publishable_') === 0) {
    throw new Error('SERVICE_KEY is the PUBLISHABLE key — it cannot write. Use the SECRET (sb_secret / service_role) key.');
  }

  // Which of our 3 facilities currently have an open, unpicked line —
  // syncing those would shift stock out from under an active picker, so
  // each one is skipped individually rather than freezing the whole feed.
  var frozenFacilities = getFrozenFacilities(SUPABASE_URL, SERVICE_KEY);
  if (frozenFacilities.length) Logger.log('Frozen this run: ' + frozenFacilities.join(', '));

  // 1) latest export email → CSV link
  var threads = GmailApp.search(EMAIL_QUERY, 0, 5);
  if (!threads.length) { Logger.log('No export email found.'); return { ok: true, status: 'no_email', rows: 0 }; }
  var msgs = threads[0].getMessages();
  var lastMsg = msgs[msgs.length - 1];
  Logger.log('Using email dated ' + lastMsg.getDate());
  var body = lastMsg.getPlainBody();
  var m = body.match(/https?:\/\/\S+?\.csv/i);
  if (!m) { Logger.log('No CSV link in email.'); return { ok: true, status: 'no_csv_link', rows: 0 }; }

  // 2) download
  var fetchRes = UrlFetchApp.fetch(m[0], { muteHttpExceptions: true });
  var csv = fetchRes.getContentText();
  var rows = Utilities.parseCsv(csv);
  if (!rows.length) { Logger.log('Empty CSV (HTTP ' + fetchRes.getResponseCode() + ').'); return { ok: true, status: 'empty_csv', rows: 0 }; }

  // 3) map header names -> column index (robust to the report adding/reordering columns)
  var header = rows[0];
  var idx = {};
  for (var key in COLUMNS) {
    var pos = header.indexOf(COLUMNS[key]);
    if (pos < 0) {
      throw new Error('Expected column "' + COLUMNS[key] + '" not found in export header. ' +
        'The report format changed — update apps-script/ShelfwiseIngest.gs COLUMNS. Header was: ' + header.join(' | '));
    }
    idx[key] = pos;
  }
  var vendorBatchIdx = header.indexOf(VENDOR_BATCH_COLUMN);
  Logger.log('Column positions: ' + JSON.stringify(idx) + ', vendorBatchIdx: ' + vendorBatchIdx);

  // 4) filter: our 3 facilities, Good inventory, Active batch status, qty > 0
  // — grouped by facility so each one can be synced (or skipped) on its own.
  var byFacility = {};
  TARGET_FACILITIES.forEach(function (f) { byFacility[f] = []; });
  var dropped = { facility: 0, invType: 0, status: 0, qtyZero: 0 };
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var facility = r[idx.facility];
    if (TARGET_FACILITIES.indexOf(facility) < 0) { dropped.facility++; continue; }
    if (r[idx.invType] !== 'GOOD_INVENTORY') { dropped.invType++; continue; }
    if (r[idx.status] !== 'Active') { dropped.status++; continue; }
    var qty = parseInt(r[idx.qty], 10);
    if (!qty || qty <= 0) { dropped.qtyZero++; continue; }
    byFacility[facility].push({
      facility: facility,
      bin: r[idx.bin] || 'DEFAULT',
      sku: r[idx.sku],
      name: r[idx.name],
      batch: r[idx.batch] || null,
      vendor_batch: (vendorBatchIdx >= 0 ? r[vendorBatchIdx] : null) || null,
      expiry: (r[idx.expiry] || '').slice(0, 10) || null,
      qty: qty,
      shelf: shelfMonths(r[idx.mfg], r[idx.expiry]),
    });
  }
  Logger.log('Dropped: ' + JSON.stringify(dropped));

  // 5) per-facility clear + bulk-insert — a frozen or empty-in-this-export
  // facility is left completely untouched (its existing stock rows stay put).
  var synced = [];
  var skipped = [];
  var totalRows = 0;
  for (var fi = 0; fi < TARGET_FACILITIES.length; fi++) {
    var fac = TARGET_FACILITIES[fi];
    if (frozenFacilities.indexOf(fac) >= 0) { skipped.push(fac); continue; }
    var facRows = byFacility[fac];
    if (!facRows.length) { Logger.log('No usable rows for ' + fac + ' this export — leaving its stock untouched.'); continue; }

    var del = supa(SUPABASE_URL, SERVICE_KEY, 'DELETE', '/rest/v1/stock?facility=eq.' + encodeURIComponent(fac));
    if (del.getResponseCode() >= 300) throw new Error('DELETE failed for ' + fac + ' ' + del.getResponseCode() + ': ' + del.getContentText());
    for (var b = 0; b < facRows.length; b += 500) {
      var resp = supa(SUPABASE_URL, SERVICE_KEY, 'POST', '/rest/v1/stock', facRows.slice(b, b + 500));
      if (resp.getResponseCode() >= 300) throw new Error('INSERT failed for ' + fac + ' ' + resp.getResponseCode() + ': ' + resp.getContentText());
    }
    synced.push(fac);
    totalRows += facRows.length;
  }

  if (!synced.length) {
    Logger.log('Nothing synced this run. Frozen: ' + (skipped.join(', ') || 'none') + '.');
    return { ok: true, status: skipped.length ? 'frozen' : 'nothing_to_insert', rows: 0, skipped: skipped };
  }

  supa(SUPABASE_URL, SERVICE_KEY, 'PATCH', '/rest/v1/sync_state?id=eq.1',
    { last_synced: new Date().toISOString(), rows: totalRows, status: skipped.length ? 'partial' : 'ok', source: 'email', updated_by: null });
  Logger.log('Done — synced ' + synced.join(', ') + ' (' + totalRows + ' rows). Skipped (frozen): ' + (skipped.join(', ') || 'none') + '.');
  return { ok: true, status: skipped.length ? 'partial' : 'synced', rows: totalRows, synced: synced, skipped: skipped };
}

/**
 * Web App entry point — what "Sync now" in the app actually calls. Requires
 * ?token=<TRIGGER_TOKEN> to match the Script Property of the same name, so a
 * random visitor who stumbles on the URL can't spam ingests. Runs the exact
 * same ingest() as the hourly trigger — including its own feed_frozen check —
 * so there is no separate on-demand code path to keep in sync with the real one.
 */
function doGet(e) {
  var token = (PropertiesService.getScriptProperties().getProperty('TRIGGER_TOKEN') || '').trim();
  var supplied = (e && e.parameter && e.parameter.token) || '';
  if (!token || supplied !== token) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, status: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var result;
  try {
    result = ingest();
  } catch (err) {
    result = { ok: false, status: 'error', message: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function shelfMonths(mfg, exp) {
  try {
    var m = new Date(mfg), e = new Date(exp);
    var months = (e.getFullYear() - m.getFullYear()) * 12 + (e.getMonth() - m.getMonth());
    return months > 0 ? months : 24;
  } catch (err) { return 24; }
}

// Returns the facility names that currently have an open, unpicked line —
// only those are skipped this run. If the check itself fails, err toward
// caution and treat every target facility as frozen rather than risk
// shifting stock under an active picker on a Supabase hiccup.
function getFrozenFacilities(url, key) {
  try {
    var res = supa(url, key, 'GET', '/rest/v1/frozen_facilities?select=facility');
    if (res.getResponseCode() >= 300) throw new Error(res.getResponseCode() + ': ' + res.getContentText());
    var arr = JSON.parse(res.getContentText());
    return arr.map(function (r) { return r.facility; });
  } catch (e) {
    Logger.log('Could not check frozen_facilities, assuming all frozen: ' + e);
    return TARGET_FACILITIES.slice();
  }
}

function supa(url, key, method, path, payload) {
  var opt = {
    method: method,
    headers: { apikey: key, Authorization: 'Bearer ' + key, Prefer: 'return=minimal' },
    contentType: 'application/json',
    muteHttpExceptions: true
  };
  if (payload) opt.payload = JSON.stringify(payload);
  return UrlFetchApp.fetch(url + path, opt);
}
