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

var INGEST_VERSION = 'v5-header-lookup';
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

  if (isFeedFrozen(SUPABASE_URL, SERVICE_KEY)) {
    Logger.log('Feed frozen — skipping.');
    return { ok: true, status: 'frozen', rows: 0 };
  }

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
  Logger.log('Column positions: ' + JSON.stringify(idx));

  // 4) filter: our 3 facilities, Good inventory, Active batch status, qty > 0
  var out = [];
  var dropped = { facility: 0, invType: 0, status: 0, qtyZero: 0 };
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    var facility = r[idx.facility];
    if (TARGET_FACILITIES.indexOf(facility) < 0) { dropped.facility++; continue; }
    if (r[idx.invType] !== 'GOOD_INVENTORY') { dropped.invType++; continue; }
    if (r[idx.status] !== 'Active') { dropped.status++; continue; }
    var qty = parseInt(r[idx.qty], 10);
    if (!qty || qty <= 0) { dropped.qtyZero++; continue; }
    out.push({
      facility: facility,
      bin: r[idx.bin] || 'DEFAULT',
      sku: r[idx.sku],
      name: r[idx.name],
      batch: r[idx.batch] || null,
      expiry: (r[idx.expiry] || '').slice(0, 10) || null,
      qty: qty,
      shelf: shelfMonths(r[idx.mfg], r[idx.expiry]),
    });
  }
  Logger.log('Parsed ' + out.length + ' usable rows. Dropped: ' + JSON.stringify(dropped));
  if (!out.length) { Logger.log('Nothing to insert.'); return { ok: true, status: 'nothing_to_insert', rows: 0 }; }

  // 5) clear + bulk-insert, checking every response code
  var del = supa(SUPABASE_URL, SERVICE_KEY, 'DELETE', '/rest/v1/stock?id=gte.0');
  if (del.getResponseCode() >= 300) throw new Error('DELETE failed ' + del.getResponseCode() + ': ' + del.getContentText());

  for (var b = 0; b < out.length; b += 500) {
    var resp = supa(SUPABASE_URL, SERVICE_KEY, 'POST', '/rest/v1/stock', out.slice(b, b + 500));
    if (resp.getResponseCode() >= 300) throw new Error('INSERT failed ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }

  supa(SUPABASE_URL, SERVICE_KEY, 'PATCH', '/rest/v1/sync_state?id=eq.1',
    { last_synced: new Date().toISOString(), rows: out.length, status: 'ok', source: 'email', updated_by: null });
  Logger.log('Done — ' + out.length + ' rows synced.');
  return { ok: true, status: 'synced', rows: out.length };
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

function isFeedFrozen(url, key) {
  try {
    var res = supa(url, key, 'GET', '/rest/v1/feed_frozen?select=frozen');
    var arr = JSON.parse(res.getContentText());
    return arr.length && arr[0].frozen === true;
  } catch (e) { return false; }
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
