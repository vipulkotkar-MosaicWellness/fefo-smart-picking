/**
 * FEFO Smart Picking — Shelfwise inventory ingestion (Google Apps Script)
 *
 * Runs on an hourly trigger AS YOUR GOOGLE ACCOUNT, so it can read the
 * "Export Job Complete - Shelfwise Inventory" email, download the CSV it links
 * to, filter to the three facilities (Good + Active, qty > 0), and push the
 * result into Supabase. The web app then reads it live.
 *
 * SETUP (once):
 *  1. script.google.com → New project → paste this file.
 *  2. Project Settings → Script Properties → add:
 *        SUPABASE_URL   = https://kytktvvcbgslwokywmds.supabase.co
 *        SERVICE_KEY    = <your Supabase service_role key>   (Settings → API)
 *     (The service_role key is secret — keep it only here, never in the app.)
 *  3. Run `ingest` once and approve the Gmail permission prompt.
 *  4. Triggers (clock icon) → Add Trigger → function: ingest,
 *     event source: Time-driven, Hour timer, Every hour.
 */

var TARGET_FACILITIES = ['SL Mother Hub', 'SL Ambient', 'SL RX'];
var EMAIL_QUERY = 'subject:"Export Job Complete - Shelfwise Inventory" newer_than:2d';

function ingest() {
  var props = PropertiesService.getScriptProperties();
  var SUPABASE_URL = props.getProperty('SUPABASE_URL');
  var SERVICE_KEY = props.getProperty('SERVICE_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SERVICE_KEY in Script Properties.');

  // Freeze rule: do not refresh stock while any picking is still open.
  if (isFeedFrozen(SUPABASE_URL, SERVICE_KEY)) {
    Logger.log('Feed frozen — open picking in progress. Skipping this run.');
    return;
  }

  // 1) find the latest export email and pull the CSV link out of the body
  var threads = GmailApp.search(EMAIL_QUERY, 0, 5);
  if (!threads.length) { Logger.log('No export email found.'); return; }
  var msgs = threads[0].getMessages();
  var body = msgs[msgs.length - 1].getPlainBody();
  var m = body.match(/https?:\/\/\S+?\.csv/i);
  if (!m) { Logger.log('No CSV link in email.'); return; }
  var csvUrl = m[0];

  // 2) download + parse the CSV
  var csv = UrlFetchApp.fetch(csvUrl, { muteHttpExceptions: true }).getContentText();
  var rows = Utilities.parseCsv(csv);
  // header indices: 0 Facility, 1 SKU, 2 Name, 3 InvType, 4 Shelf/bin,
  //                 9 Qty, 15 Batch, 16 Expiry, 18 Mfg, 21 Batch Status
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (r.length < 22) continue;
    if (TARGET_FACILITIES.indexOf(r[0]) < 0) continue;
    if (r[3] !== 'GOOD_INVENTORY' || r[21] !== 'Active') continue;
    var qty = parseInt(r[9], 10);
    if (!qty || qty <= 0) continue;
    out.push({
      facility: r[0],
      bin: r[4] || 'DEFAULT',
      sku: r[1],
      name: r[2],
      batch: r[15] || null,
      expiry: (r[16] || '').slice(0, 10) || null,
      qty: qty,
      shelf: shelfMonths(r[18], r[16])
    });
  }
  Logger.log('Parsed ' + out.length + ' usable rows.');

  // 3) clear the stock table (it only ever holds these 3 facilities), then bulk-insert
  supa(SUPABASE_URL, SERVICE_KEY, 'DELETE', '/rest/v1/stock?id=gte.0');
  for (var b = 0; b < out.length; b += 500) {
    supa(SUPABASE_URL, SERVICE_KEY, 'POST', '/rest/v1/stock', out.slice(b, b + 500));
  }

  // 4) stamp the sync
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
