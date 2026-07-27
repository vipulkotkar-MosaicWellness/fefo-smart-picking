/**
 * FEFO Smart Picking — Shelfwise inventory ingestion (Google Apps Script)
 * Reads the export email hourly, downloads the CSV, filters to the 3 facilities
 * (Good + Active, qty>0) and pushes to Supabase. See apps-script/README.md.
 *
 * SETUP: Script Properties →  SUPABASE_URL = https://kytktvvcbgslwokywmds.supabase.co
 *                             SERVICE_KEY  = <SECRET service_role / sb_secret key>
 * Then run `ingest` and add an hourly time-driven trigger.
 */

var INGEST_VERSION = 'v3-diagnostic';
var TARGET_FACILITIES = ['SL Mother Hub', 'SL Ambient', 'SL RX'];
var EMAIL_QUERY = 'subject:"Export Job Complete - Shelfwise Inventory" newer_than:2d';

function ingest() {
  Logger.log('ingest ' + INGEST_VERSION + ' starting');
  var props = PropertiesService.getScriptProperties();
  var SUPABASE_URL = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var SERVICE_KEY = (props.getProperty('SERVICE_KEY') || '').trim();
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SERVICE_KEY in Script Properties.');
  Logger.log('URL=' + SUPABASE_URL + ' · key starts with "' + SERVICE_KEY.slice(0, 11) + '…" len=' + SERVICE_KEY.length);
  if (SERVICE_KEY.indexOf('sb_publishable_') === 0) {
    throw new Error('SERVICE_KEY is the PUBLISHABLE key — it cannot write. Use the SECRET (sb_secret / service_role) key.');
  }

  if (isFeedFrozen(SUPABASE_URL, SERVICE_KEY)) { Logger.log('Feed frozen — skipping.'); return; }

  // 1) latest export email → CSV link
  var threads = GmailApp.search(EMAIL_QUERY, 0, 5);
  if (!threads.length) { Logger.log('No export email found.'); return; }
  var msgs = threads[0].getMessages();
  var body = msgs[msgs.length - 1].getPlainBody();
  var m = body.match(/https?:\/\/\S+?\.csv/i);
  if (!m) { Logger.log('No CSV link in email.'); return; }

  // 2) download + parse + filter
  var csv = UrlFetchApp.fetch(m[0], { muteHttpExceptions: true }).getContentText();
  var rows = Utilities.parseCsv(csv);
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r.length < 22) continue;
    if (TARGET_FACILITIES.indexOf(r[0]) < 0) continue;
    if (r[3] !== 'GOOD_INVENTORY' || r[21] !== 'Active') continue;
    var qty = parseInt(r[9], 10);
    if (!qty || qty <= 0) continue;
    out.push({ facility: r[0], bin: r[4] || 'DEFAULT', sku: r[1], name: r[2],
      batch: r[15] || null, expiry: (r[16] || '').slice(0, 10) || null, qty: qty, shelf: shelfMonths(r[18], r[16]) });
  }
  Logger.log('Parsed ' + out.length + ' usable rows.');
  if (!out.length) { Logger.log('Nothing to insert.'); return; }

  // 3) clear + bulk-insert, checking every response code
  var del = supa(SUPABASE_URL, SERVICE_KEY, 'DELETE', '/rest/v1/stock?id=gte.0');
  Logger.log('DELETE code=' + del.getResponseCode());
  if (del.getResponseCode() >= 300) throw new Error('DELETE failed ' + del.getResponseCode() + ': ' + del.getContentText());

  for (var b = 0; b < out.length; b += 500) {
    var resp = supa(SUPABASE_URL, SERVICE_KEY, 'POST', '/rest/v1/stock', out.slice(b, b + 500));
    if (b === 0) Logger.log('first INSERT code=' + resp.getResponseCode() + ' body=' + resp.getContentText().slice(0, 200));
    if (resp.getResponseCode() >= 300) throw new Error('INSERT failed ' + resp.getResponseCode() + ': ' + resp.getContentText());
  }

  // 4) verify by counting the table ourselves
  var chk = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/stock?select=facility&limit=1',
    { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, Prefer: 'count=exact' }, muteHttpExceptions: true });
  Logger.log('table count header=' + chk.getAllHeaders()['Content-Range']);

  supa(SUPABASE_URL, SERVICE_KEY, 'PATCH', '/rest/v1/sync_state?id=eq.1',
    { last_synced: new Date().toISOString(), rows: out.length, status: 'ok' });
  Logger.log('Done — ' + out.length + ' rows synced.');
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
