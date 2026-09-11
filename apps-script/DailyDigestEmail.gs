/**
 * FEFO Smart Picking — Daily Ops Digest email (Google Apps Script)
 *
 * Sends the recurring team digest (Gate Pass Adherence trend + yesterday's
 * breach drivers, Stock Holds aging, Picking Pending / Gate Pass Allocation
 * Pending) as one HTML email, entirely server-side — no browser tab, no
 * Claude session needs to be running. Runs on its own daily time trigger.
 *
 * WHY THIS LIVES HERE (not a Claude "scheduled task"): a Claude scheduled
 * task would re-invoke an AI model every morning just to re-derive numbers
 * and re-write HTML it already knows how to write — that costs real tokens
 * every single day, forever. This is a plain script instead: it costs
 * nothing to run and never changes unless you ask Claude to edit it.
 *
 * Lives in the SAME Apps Script project as ShelfwiseIngest.gs and
 * GatepassAdherenceCheck.gs — reuses their SUPABASE_URL / SERVICE_KEY
 * Script Properties, and this project's Gmail permission (already granted
 * for those two files, so sending mail needs no new sign-in or OAuth app).
 * All names below are DD_-prefixed to avoid colliding with the other two
 * files' globals in the same project.
 *
 * The 14-day trend is a REAL chart image (rendered via QuickChart.io —
 * Apps Script's own built-in Charts service was tried first, but doesn't
 * reliably support per-bar value labels or a set fill color — and attached
 * inline via cid:), not a link out to a separate page. Attaching an inline
 * image works here even though the same trick failed over Claude's Gmail
 * send tool earlier, because GmailApp.sendEmail builds its own MIME message
 * directly — it isn't passing through that tool's separate content
 * sanitizer, which was what stripped images/SVG/etc there. Only the 14
 * (date, percentage) points plotted in the chart are sent to QuickChart —
 * no SKU, gate pass, or facility-level detail.
 *
 * ── ONE-TIME SETUP ──────────────────────────────────────────────────────
 * 1. Edit DD_RECIPIENTS / DD_CC below if the distribution list changes.
 * 2. In the Apps Script editor, select function `sendDailyDigestTest` from
 *    the Run dropdown → Run. First run asks you to approve Gmail access
 *    (approve it) — a test email lands in DD_TEST_RECIPIENT's inbox.
 * 3. Check it looks right. Then, in Triggers (clock icon) → Add Trigger:
 *      Function: sendDailyDigest · Event source: Time-driven ·
 *      Type: Day timer · Time of day: 9am to 10am (IST, this project's
 *      Apps Script timezone — see Project Settings if unsure).
 * 4. Flip DD_TEST_MODE to false below ONLY once you're ready for the whole
 *    team to start receiving it automatically every morning.
 * ───────────────────────────────────────────────────────────────────────
 */

// ── EDIT THESE ─────────────────────────────────────────────────────────
var DD_TEST_MODE = false; // true = every send (incl. the daily trigger) goes ONLY to DD_TEST_RECIPIENT
var DD_TEST_RECIPIENT = 'vipul.kotkar@mosaicwellness.in';

var DD_RECIPIENTS = [
  'niraj.jaiswal@mosaicwellness.in',
  'manish.khaladkar@mosaicwellness.in',
  'shailendra.singh@mosaicwellness.in',
  'rupesh.shelar@mosaicwellness.in',
  'bhavesh.patel@mosaicwellness.in',
];
var DD_CC = ['shashank.upadhyay@mosaicwellness.in'];
// ──────────────────────────────────────────────────────────────────────

var DD_FACILITIES = ['SL Mother Hub', 'SL Ambient', 'SL RX'];
var DD_TREND_DAYS = 14;
var DD_APP_URL = 'https://fefo-smart-picking.vercel.app';
var DD_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What the daily 9 AM trigger calls. */
function sendDailyDigest() {
  return ddRun_(false);
}

/** Manual one-off check — ALWAYS goes to DD_TEST_RECIPIENT only, regardless of DD_TEST_MODE. Run this from the editor before trusting the daily trigger. */
function sendDailyDigestTest() {
  return ddRun_(true);
}

function ddRun_(forceTestOnly) {
  var props = PropertiesService.getScriptProperties();
  var SUPABASE_URL = (props.getProperty('SUPABASE_URL') || '').trim().replace(/\/+$/, '');
  var SERVICE_KEY = (props.getProperty('SERVICE_KEY') || '').trim();
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error('Set SUPABASE_URL and SERVICE_KEY in Script Properties.');

  var now = new Date();
  var yesterdayIso = ddIsoDaysAgo_(now, 1);
  var trendStartIso = ddIsoDaysAgo_(now, DD_TREND_DAYS);

  var gpaRows = ddFetchAll_(SUPABASE_URL, SERVICE_KEY,
    '/rest/v1/gatepass_adherence?select=report_date,facility,gatepass_code,instructed_qty,compliant_qty,lines&report_date=gte.' + trendStartIso);
  var trend = ddBuildTrend_(gpaRows);
  var breach = ddBuildBreach_(gpaRows, yesterdayIso);

  var holdRows = ddFetchAll_(SUPABASE_URL, SERVICE_KEY, '/rest/v1/stock_holds?select=facility,qty,held_at&released_at=is.null');
  var holds = ddBuildHolds_(holdRows, now);

  var taskRows = ddFetchAll_(SUPABASE_URL, SERVICE_KEY, '/rest/v1/tasks?select=no,data');
  var queues = ddBuildQueues_(taskRows, now);

  var subjectDate = ddLongDate_(now);
  var subject = (forceTestOnly || DD_TEST_MODE ? '[TEST] ' : '') + 'FEFO Smart Picking — Daily Ops Digest — ' + subjectDate;

  var chart = ddBuildChart_(trend.points);
  var html = ddBuildHtml_(now, yesterdayIso, trend, breach, holds, queues, chart, forceTestOnly);

  var mailOptions = { htmlBody: html, name: 'FEFO Smart Picking' };
  if (chart.blob) mailOptions.inlineImages = { trendchart: chart.blob };

  if (forceTestOnly || DD_TEST_MODE) {
    GmailApp.sendEmail(DD_TEST_RECIPIENT, subject, 'This email needs an HTML-capable client to view.', mailOptions);
  } else {
    mailOptions.cc = DD_CC.join(',');
    GmailApp.sendEmail(DD_RECIPIENTS.join(','), subject, 'This email needs an HTML-capable client to view.', mailOptions);
  }

  return { ok: true, sentTestOnly: !!(forceTestOnly || DD_TEST_MODE), subject: subject };
}

// ── Data shaping ──────────────────────────────────────────────────────

function ddBuildTrend_(gpaRows) {
  var byDate = {};
  gpaRows.forEach(function (r) {
    byDate[r.report_date] = byDate[r.report_date] || { instructed: 0, compliant: 0, gpCount: 0 };
    byDate[r.report_date].instructed += r.instructed_qty;
    byDate[r.report_date].compliant += r.compliant_qty;
    byDate[r.report_date].gpCount++;
  });
  var dates = Object.keys(byDate).sort();
  var points = dates.map(function (d) {
    var v = byDate[d];
    return { date: d, pct: v.instructed > 0 ? (v.compliant / v.instructed) * 100 : 0, gpCount: v.gpCount };
  });
  var totalInstructed = 0, totalCompliant = 0, totalGp = 0;
  dates.forEach(function (d) { totalInstructed += byDate[d].instructed; totalCompliant += byDate[d].compliant; totalGp += byDate[d].gpCount; });
  var best = points.reduce(function (a, b) { return !a || b.pct > a.pct ? b : a; }, null);
  var worst = points.reduce(function (a, b) { return !a || b.pct < a.pct ? b : a; }, null);
  return {
    points: points, daysWithData: dates.length,
    overallPct: totalInstructed > 0 ? (totalCompliant / totalInstructed) * 100 : 0,
    totalCompliant: totalCompliant, totalInstructed: totalInstructed, totalGp: totalGp,
    best: best, worst: worst,
  };
}

function ddBuildBreach_(gpaRows, yesterdayIso) {
  var yRows = gpaRows.filter(function (r) { return r.report_date === yesterdayIso; });
  var yInstructed = 0, yCompliant = 0;
  var byFacility = {};
  var skuShort = {};
  var gpShort = {};
  // Buckets under the new batch-only rule: a "breach" is only a wrong batch
  // or nothing picked. A partial pick of the correct batch still costs units
  // but is NOT a breach. Shelf mismatch (right batch, wrong bin) costs
  // nothing and is tracked only as a count.
  var batchMismatchUnits = 0, batchMismatchLines = 0;
  var notPickedUnits = 0, notPickedLines = 0;
  var partialUnits = 0, partialLines = 0;
  var shelfMismatchLines = 0;

  yRows.forEach(function (r) {
    yInstructed += r.instructed_qty; yCompliant += r.compliant_qty;
    byFacility[r.facility] = byFacility[r.facility] || { instructed: 0, compliant: 0, gpCount: 0 };
    byFacility[r.facility].instructed += r.instructed_qty;
    byFacility[r.facility].compliant += r.compliant_qty;
    byFacility[r.facility].gpCount++;

    gpShort[r.gatepass_code] = gpShort[r.gatepass_code] || { facility: r.facility, instructed: 0, compliant: 0 };
    gpShort[r.gatepass_code].instructed += r.instructed_qty;
    gpShort[r.gatepass_code].compliant += r.compliant_qty;

    (r.lines || []).forEach(function (l) {
      var reason = ddLineReason_(l);
      if (reason === 'Bin & batch match' || reason === 'Non-expiry SKU') return;
      var short = l.instructed_qty - l.compliant_qty;
      if (reason === 'Batch mismatch') { batchMismatchUnits += short; batchMismatchLines++; }
      else if (reason === 'Not picked') { notPickedUnits += short; notPickedLines++; }
      else if (reason === 'Partial pick — correct batch') { partialUnits += short; partialLines++; }
      else if (reason === 'Batch match, bin mismatch') { shelfMismatchLines++; return; }
      if (short <= 0) return;
      var key = l.sku + '|' + (l.name || l.sku);
      skuShort[key] = skuShort[key] || { sku: l.sku, name: l.name || l.sku, short: 0, lines: 0, instructed: 0, compliant: 0 };
      skuShort[key].short += short;
      skuShort[key].lines++;
      skuShort[key].instructed += l.instructed_qty;
      skuShort[key].compliant += l.compliant_qty;
    });
  });

  var facilityRows = DD_FACILITIES.filter(function (f) { return byFacility[f]; }).map(function (f) {
    var v = byFacility[f];
    return { facility: f, instructed: v.instructed, compliant: v.compliant, gpCount: v.gpCount, pct: v.instructed > 0 ? (v.compliant / v.instructed) * 100 : 0 };
  });
  var topSkus = Object.keys(skuShort).map(function (k) { return skuShort[k]; })
    .sort(function (a, b) { return b.short - a.short; }).slice(0, 5);
  var topGps = Object.keys(gpShort).map(function (k) {
    var v = gpShort[k];
    return { code: k, facility: v.facility, short: v.instructed - v.compliant, instructed: v.instructed, compliant: v.compliant, pct: v.instructed > 0 ? (v.compliant / v.instructed) * 100 : 0 };
  }).sort(function (a, b) { return b.short - a.short; }).slice(0, 5);

  return {
    instructed: yInstructed, compliant: yCompliant, pct: yInstructed > 0 ? (yCompliant / yInstructed) * 100 : 0,
    gpCount: yRows.length, facilityRows: facilityRows, topSkus: topSkus, topGps: topGps,
    batchMismatchUnits: batchMismatchUnits, batchMismatchLines: batchMismatchLines,
    notPickedUnits: notPickedUnits, notPickedLines: notPickedLines,
    partialUnits: partialUnits, partialLines: partialLines,
    shelfMismatchLines: shelfMismatchLines,
    breachUnits: batchMismatchUnits + notPickedUnits, breachLines: batchMismatchLines + notPickedLines,
  };
}

/** Reason from a gatepass_adherence line of either shape — new (`reason`) or a pre-Sep-2026 row still on `status`. */
function ddLineReason_(l) {
  if (l.reason) return l.reason;
  if (l.status === 'OK') return 'Bin & batch match';
  if (l.status === 'PARTIAL') return 'Partial pick — correct batch';
  if (l.status === 'BIN BREACH') return 'Batch mismatch';
  return 'Bin & batch match';
}

function ddBuildHolds_(holdRows, now) {
  var buckets = [
    { key: 'lt2', label: '< 2 days', test: function (d) { return d < 2; } },
    { key: '2to5', label: '2 to 5 days', test: function (d) { return d >= 2 && d <= 5; } },
    { key: '6to10', label: '6 to 10 days', test: function (d) { return d >= 6 && d <= 10; } },
    { key: 'gt10', label: '> 10 days', test: function (d) { return d > 10; } },
  ];
  var byBucketFacility = {};
  var facilityTotals = {};
  var totalUnits = 0, totalCount = 0, oldestDays = 0, over6Units = 0, over6Count = 0;

  holdRows.forEach(function (h) {
    var ageDays = Math.floor((now.getTime() - new Date(h.held_at).getTime()) / 86400000);
    if (ageDays > oldestDays) oldestDays = ageDays;
    totalUnits += h.qty; totalCount++;
    facilityTotals[h.facility] = (facilityTotals[h.facility] || 0) + h.qty;
    if (ageDays >= 6) { over6Units += h.qty; over6Count++; }
    var bucket = buckets.filter(function (b) { return b.test(ageDays); })[0];
    if (bucket) {
      byBucketFacility[bucket.key] = byBucketFacility[bucket.key] || {};
      byBucketFacility[bucket.key][h.facility] = (byBucketFacility[bucket.key][h.facility] || 0) + h.qty;
    }
  });

  var topFacility = DD_FACILITIES.reduce(function (a, f) {
    var u = facilityTotals[f] || 0;
    return (!a || u > a.units) ? { facility: f, units: u } : a;
  }, null);

  return {
    buckets: buckets, byBucketFacility: byBucketFacility, facilityTotals: facilityTotals,
    totalUnits: totalUnits, totalCount: totalCount, oldestDays: oldestDays,
    over6Units: over6Units, over6Count: over6Count, topFacility: topFacility,
  };
}

function ddBuildQueues_(taskRows, now) {
  var buckets = [
    { key: 'd1', label: 'Day 1', test: function (d) { return d === 0; } },
    { key: 'd2', label: 'Day 2', test: function (d) { return d === 1; } },
    { key: '2to5', label: '2 to 5 days', test: function (d) { return d >= 2 && d <= 5; } },
    { key: '6to10', label: '6 to 10 days', test: function (d) { return d >= 6 && d <= 10; } },
    { key: 'gt10', label: '> 10 days', test: function (d) { return d > 10; } },
  ];
  var pickingPending = {}; // bucketKey -> facility -> units
  var gpAllocPending = {}; // bucketKey -> facility -> picklist count
  var pickingPendingTotal = 0, gpAllocPendingTotal = 0, pickingPicklistCount = 0;

  taskRows.forEach(function (row) {
    var task = row.data;
    if (!task || task.archived || !task.facilities) return;
    task.facilities.forEach(function (f) {
      if (f.discarded) return;
      var gatePassNo = f.gatePassNo || task.gatePassNo;
      var createdAt = f.createdAt || task.createdAt;
      if (!createdAt) return;
      var ageDays = Math.floor((now.getTime() - new Date(createdAt).getTime()) / 86400000);
      var bucket = buckets.filter(function (b) { return b.test(ageDays); })[0];
      if (!bucket) return;

      // Gate Pass Allocation Pending: fully allocated, but no gate pass number yet
      // — never reaches the picking queue at all. Checked first because it's
      // orthogonal to wmsBlocked below (a picklist can be missing its gate
      // pass whether or not WMS has also blocked it).
      if (!gatePassNo) {
        gpAllocPending[bucket.key] = gpAllocPending[bucket.key] || {};
        gpAllocPending[bucket.key][f.facility] = (gpAllocPending[bucket.key][f.facility] || 0) + 1;
        gpAllocPendingTotal++;
        return;
      }

      // Picking Pending: has its gate pass, but WMS has blocked the stock —
      // sitting in the queue waiting to be picked. Units = lines nobody has
      // touched yet at all (l.picked == null), matching the app's own
      // pendingUnits definition in supervisorMetrics.ts.
      if (f.status === 'completed' || !f.wmsBlocked) return;
      var pendingUnits = (f.lines || []).reduce(function (s, l) { return s + (l.picked == null ? l.qty : 0); }, 0);
      if (pendingUnits <= 0) return;
      pickingPending[bucket.key] = pickingPending[bucket.key] || {};
      pickingPending[bucket.key][f.facility] = (pickingPending[bucket.key][f.facility] || 0) + pendingUnits;
      pickingPendingTotal += pendingUnits;
      pickingPicklistCount++;
    });
  });

  return {
    buckets: buckets, pickingPending: pickingPending, gpAllocPending: gpAllocPending,
    pickingPendingTotal: pickingPendingTotal, gpAllocPendingTotal: gpAllocPendingTotal, pickingPicklistCount: pickingPicklistCount,
  };
}

// ── Chart (real inline image via QuickChart.io) ──────────────────────
//
// Tried Apps Script's own built-in `Charts` service first (Google's native
// server-side chart renderer, zero external dependency) — but it doesn't
// reliably support per-bar value labels, and in testing rendered the bars
// without the requested fill color. QuickChart.io is a plain chart-image
// API: give it a Chart.js config as a URL parameter, get back a PNG. What
// it's sent is exactly the 14 (date, percentage) pairs plotted below —
// no SKU, gate pass, or facility-level detail ever leaves Supabase/Gmail.

/** Same 3 thresholds/colors as ADHERENCE_STATUS in src/components/GatepassAdherence.tsx — keep in lockstep with that file if it ever changes. */
function ddStatusColor_(pct) {
  if (pct >= 95) return '#10b981';
  if (pct >= 80) return '#f59e0b';
  return '#e11d48';
}

function ddChartLegend_() {
  var items = [
    { color: '#10b981', label: 'On target (≥95%)' },
    { color: '#f59e0b', label: 'Watch (80–94%)' },
    { color: '#e11d48', label: 'Below target (<80%)' },
  ];
  return '<div style="margin:-0.9rem 0 1.25rem;font-size:0.72rem;color:#516b62;">'
    + items.map(function (i) {
        return '<span style="display:inline-block;margin-right:14px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:' + i.color + ';margin-right:5px;"></span>' + i.label + '</span>';
      }).join('')
    + '</div>';
}

function ddBuildChart_(points) {
  if (!points.length) return { blob: null };
  try {
    var labels = points.map(function (p) { return ddShortDate_(p.date); });
    // Whole-number percentages — QuickChart's GET endpoint doesn't evaluate
    // JS-callback strings (tried a %-suffix formatter first; it errored with
    // "is not a function" instead of being eval'd), so labels are plain
    // numbers rather than "79%" — the chart title states the unit instead.
    var values = points.map(function (p) { return Math.round(p.pct); });
    // Per-bar status color, not one flat color — matches the live app's own
    // TrendChart (ADHERENCE_STATUS in GatepassAdherence.tsx exactly): color
    // here means "how far from target", not "which day". Legend for these
    // goes under the image in the HTML (see ddChartLegend_).
    var colors = values.map(ddStatusColor_);
    var config = {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Adherence %',
          data: values,
          backgroundColor: colors,
          datalabels: { anchor: 'end', align: 'top', color: '#063a33', font: { weight: 'bold', size: 11 } },
        }],
      },
      options: {
        title: { display: true, text: 'Gate Pass Adherence % — last ' + points.length + ' days', fontColor: '#063a33' },
        legend: { display: false },
        scales: { yAxes: [{ ticks: { min: 0, max: 100 } }] },
        plugins: { datalabels: { anchor: 'end', align: 'top' } },
      },
    };
    var url = 'https://quickchart.io/chart?width=650&height=280&backgroundColor=white&c=' + encodeURIComponent(JSON.stringify(config));
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) {
      Logger.log('QuickChart returned ' + resp.getResponseCode() + ', falling back to link-only.');
      return { blob: null };
    }
    return { blob: resp.getBlob().setName('trendchart.png') };
  } catch (err) {
    Logger.log('Chart build failed, falling back to link-only: ' + err);
    return { blob: null };
  }
}

// ── HTML ──────────────────────────────────────────────────────────────

function ddBuildHtml_(now, yesterdayIso, trend, breach, holds, queues, chart, forceTestOnly) {
  var testBanner = (forceTestOnly || DD_TEST_MODE)
    ? '<div style="background-color:#fff3cd;color:#6b4d00;border:1px solid #f0d78c;border-radius:8px;padding:0.6rem 0.9rem;font-size:0.8rem;margin-bottom:1.25rem;">TEST MODE — sending to you only. Flip DD_TEST_MODE to false in DailyDigestEmail.gs once this looks right.</div>'
    : '';

  var chartBlock = chart.blob
    ? '<img src="cid:trendchart" alt="Gate Pass Adherence trend" style="max-width:100%;display:block;margin:0 0 0.4rem;border:1px solid #d7e3de;border-radius:10px;">' + ddChartLegend_()
    : '<div style="margin:0 0 1.25rem;padding:0.75rem 0.9rem;background-color:#fbfdfc;border:1px solid #d7e3de;border-radius:10px;font-size:0.8rem;color:#516b62;"><b style="color:#10241f;">14-day trend chart:</b> could not be generated this run. See the live app: <a href="' + DD_APP_URL + '" style="color:#087f6d;">' + DD_APP_URL.replace('https://', '') + '</a></div>';

  var html = '<div style="max-width:720px;margin:0 auto;padding:1.25rem 1.5rem 1rem;font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#10241f;">'
    + testBanner
    + '<p style="font-size:1.15rem;font-weight:700;margin:0 0 0.15rem;color:#063a33;">FEFO Smart Picking — Daily Ops Digest — ' + ddLongDate_(now) + '</p>'
    + '<p style="font-size:0.78rem;color:#516b62;margin:0 0 1.5rem;line-height:1.6;"><b style="color:#10241f;">Data as of:</b> ' + ddLongDate_(now) + ', ' + Utilities.formatDate(now, 'Asia/Kolkata', 'h:mm a') + ' IST</p>'

    + ddSectionHeader_('1 · Gate Pass Adherence', true)
    + ddCardRow_([
        ddCard_('Overall adherence', ddPct_(trend.overallPct), ddNum_(trend.totalCompliant) + ' / ' + ddNum_(trend.totalInstructed) + ' units', trend.overallPct >= 80 ? 'good' : 'bad'),
        ddCard_('Gate passes checked', String(trend.totalGp), 'over last ' + trend.daysWithData + ' days', 'neutral'),
        ddCard_('Best day', trend.best ? ddPct_(trend.best.pct) : '—', trend.best ? ddLongDateIso_(trend.best.date) : '', 'good'),
        ddCard_('Worst day', trend.worst ? ddPct_(trend.worst.pct) : '—', trend.worst ? ddLongDateIso_(trend.worst.date) : '', 'bad'),
      ])
    + chartBlock

    + ddSectionHeader_('2 · Breach Drivers — Yesterday (' + ddLongDateIso_(yesterdayIso) + ')', false)
    + '<p style="font-size:0.8rem;color:#516b62;margin:-0.4rem 0 0.9rem;line-height:1.5;">Scoped to yesterday\'s closed gate passes only, not the rolling window above. A FEFO breach = a different batch was picked, or nothing was picked. Right batch / wrong shelf is not a breach.</p>'
    + ddCardRow_([
        ddCard_('Yesterday\'s adherence', ddPct_(breach.pct), ddNum_(breach.compliant) + ' / ' + ddNum_(breach.instructed) + ' units', breach.pct >= 80 ? 'good' : 'bad'),
        ddCard_('Gate passes', String(breach.gpCount), 'closed ' + ddLongDateIso_(yesterdayIso), 'neutral'),
        ddCard2_('FEFO breaches', ddNum_(breach.breachUnits) + ' units · ' + breach.breachLines + ' lines', ddNum_(breach.batchMismatchUnits) + ' wrong batch · ' + ddNum_(breach.notPickedUnits) + ' not picked'),
      ])
    + (breach.facilityRows.length ? ddFacilityAdherenceTable_(breach.facilityRows) : ddNote_('No gate passes closed yesterday — nothing to score.'))
    + (breach.topSkus.length ? ddTopSkusTable_(breach.topSkus) : '')
    + (breach.topGps.length ? ddTopGpsTable_(breach.topGps) : '')
    + (breach.topSkus.length
        ? '<p style="font-size:0.8rem;color:#516b62;margin:-0.5rem 0 0.9rem;line-height:1.5;">Yesterday, units short by reason: '
          + ddPill_('Wrong batch — ' + ddNum_(breach.batchMismatchUnits) + ' units · ' + breach.batchMismatchLines + ' lines', 'bad')
          + '&nbsp; ' + ddPill_('Not picked — ' + ddNum_(breach.notPickedUnits) + ' units · ' + breach.notPickedLines + ' lines', 'bad')
          + '&nbsp; ' + ddPill_('Partial pick, correct batch — ' + ddNum_(breach.partialUnits) + ' units · ' + breach.partialLines + ' lines', 'warn')
          + '. Wrong batch and not picked are FEFO breaches; a partial pick of the correct batch is a fill-rate gap, not a breach. '
          + 'Right batch from a different shelf: ' + breach.shelfMismatchLines + ' lines (not counted — separate shelf report later).</p>'
        : '')

    + ddSectionHeader_('3 · Inventory on Hold', false)
    + ddCardRow_([
        ddCard_('Units on hold', ddNum_(holds.totalUnits), holds.totalCount + ' holds', 'neutral'),
        ddCard_('Aging > 6 days', ddNum_(holds.over6Units), holds.over6Count + ' holds need review', holds.over6Units > 0 ? 'bad' : 'good'),
        ddCard_('Oldest hold', holds.totalCount ? holds.oldestDays + ' days' : '—', 'since placed', 'warn'),
        holds.topFacility && holds.totalUnits > 0
          ? ddCard_('Top concentration', holds.topFacility.facility, Math.round((holds.topFacility.units / holds.totalUnits) * 100) + '% · ' + ddNum_(holds.topFacility.units) + ' units', 'neutral')
          : ddCard_('Top concentration', '—', '', 'neutral'),
      ])
    + (holds.totalCount ? ddAgingFacilityTable_('Age of hold', holds.buckets, holds.byBucketFacility, holds.facilityTotals, holds.totalUnits) : ddNote_('No stock currently on hold.'))

    + ddSectionHeader_('4 · Picking Pending &amp; Gate Pass Allocation Pending', false)
    + '<p style="font-size:0.8rem;color:#516b62;margin:-0.4rem 0 0.9rem;line-height:1.5;">Picking Pending = picklists with a gate pass, waiting to be picked because WMS has the stock blocked. Gate Pass Allocation Pending = fully allocated picklists still waiting on a gate pass number before they even reach the picking queue. Either table is skipped on a day its total is zero.</p>'
    + (queues.pickingPendingTotal
        ? ddQueueTable_('Picking pending — units, by age &amp; facility', queues.buckets, queues.pickingPending, ddSumByFacility_(queues.pickingPending), queues.pickingPendingTotal)
        : ddNote_('Nothing waiting on picking right now.'))
    + (queues.gpAllocPendingTotal
        ? ddQueueTable_('Gate pass allocation pending — picklists, by age &amp; facility', queues.buckets, queues.gpAllocPending, ddSumByFacility_(queues.gpAllocPending), queues.gpAllocPendingTotal)
        : ddNote_('Nothing waiting on a gate pass right now.'))

    + '<div style="border-top:1px solid #d7e3de;margin-top:1.5rem;padding-top:0.9rem;font-size:0.72rem;color:#516b62;">'
    + 'Generated automatically from live data · <a href="' + DD_APP_URL + '" style="color:#087f6d;text-decoration:none;">' + DD_APP_URL.replace('https://', '') + '</a><br>'
    + 'Prepared by Vipul Kotkar · Supply Chain, Mosaic Wellness</div>'
    + '</div>';

  return html;
}

function ddSectionHeader_(title, first) {
  var style = 'font-size:0.72rem;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:#087f6d;margin:' + (first ? '0 0 0.75rem' : '1.75rem 0 0.75rem') + ';padding-top:' + (first ? '0' : '1.25rem') + ';border-top:' + (first ? 'none' : '1px solid #d7e3de') + ';';
  return '<h2 style="' + style + '">' + title + '</h2>';
}

function ddCardRow_(cellsHtml) {
  return '<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px 0.75rem;"><tr>' + cellsHtml.join('') + '</tr></table>';
}

function ddCard_(label, value, sub, tone) {
  var colors = { good: '#0f7a4f', bad: '#b3261e', warn: '#9a6300', neutral: '#063a33' };
  var bg = tone === 'good' || tone === 'neutral' ? '#e1f5ee' : (tone === 'bad' ? '#fbe7e5' : '#fdf1da');
  return '<td style="background-color:' + bg + ';border-radius:8px;padding:0.65rem 0.8rem;width:25%;vertical-align:top;">'
    + '<span style="display:block;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.04em;color:#516b62;margin-bottom:2px;">' + label + '</span>'
    + '<span style="display:block;font-size:1.15rem;font-weight:700;color:' + (colors[tone] || colors.neutral) + ';">' + value + '</span>'
    + '<span style="display:block;font-size:0.62rem;color:#516b62;margin-top:2px;">' + sub + '</span></td>';
}

function ddCard2_(label, value, sub) {
  return '<td colspan="2" style="background-color:#e1f5ee;border-radius:8px;padding:0.65rem 0.8rem;width:50%;vertical-align:top;">'
    + '<span style="display:block;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.04em;color:#516b62;margin-bottom:2px;">' + label + '</span>'
    + '<span style="display:block;font-size:0.85rem;line-height:1.4;font-weight:700;color:#063a33;">' + value + '</span>'
    + '<span style="display:block;font-size:0.62rem;color:#516b62;margin-top:2px;">' + sub + '</span></td>';
}

function ddNote_(text) {
  return '<p style="margin:0 0 0.75rem;padding:0.6rem 0.8rem;background-color:#e1f5ee;border-radius:8px;color:#063a33;font-weight:600;font-size:0.8rem;">' + text + '</p>';
}

function ddPill_(text, tone) {
  var bg = tone === 'bad' ? '#fbe7e5' : '#fdf1da';
  var fg = tone === 'bad' ? '#b3261e' : '#9a6300';
  return '<span style="display:inline-block;padding:1px 7px;border-radius:20px;font-size:0.68rem;font-weight:700;background-color:' + bg + ';color:' + fg + ';">' + text + '</span>';
}

function ddTh_(text, align) {
  return '<th style="text-align:' + (align || 'left') + ';background-color:#f4f8f6;font-size:0.64rem;text-transform:uppercase;letter-spacing:0.03em;color:#516b62;font-weight:700;padding:0.4rem 0.55rem;border:1px solid #d7e3de;">' + text + '</th>';
}

function ddTd_(text, align, extraStyle) {
  return '<td style="text-align:' + (align || 'left') + ';padding:0.4rem 0.55rem;border:1px solid #d7e3de;' + (extraStyle || '') + '">' + text + '</td>';
}

function ddAdherenceTone_(pct) {
  if (pct >= 85) return { bg: '#e4f5ec', fg: '#0f7a4f' };
  if (pct >= 70) return { bg: '#fdf1da', fg: '#9a6300' };
  return { bg: '#fbe7e5', fg: '#b3261e' };
}

function ddFacilityAdherenceTable_(rows) {
  var body = rows.map(function (r) {
    var tone = ddAdherenceTone_(r.pct);
    return '<tr>' + ddTd_(r.facility, 'left', 'font-weight:600;') + ddTd_(ddNum_(r.compliant) + ' / ' + ddNum_(r.instructed), 'right')
      + ddTd_(ddPct_(r.pct), 'right', 'background-color:' + tone.bg + ';color:' + tone.fg + ';font-weight:700;') + ddTd_(String(r.gpCount), 'right') + '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;margin-bottom:0.5rem;"><tr>'
    + ddTh_('Facility') + ddTh_('Compliant / Instructed', 'right') + ddTh_('Adherence', 'right') + ddTh_('Gate passes', 'right')
    + '</tr>' + body + '</table>';
}

function ddTopSkusTable_(rows) {
  var body = rows.map(function (r, i) {
    var linePct = r.instructed > 0 ? (r.compliant / r.instructed) * 100 : 0;
    return '<tr>' + ddTd_(String(i + 1), 'center', 'font-weight:700;color:#087f6d;') + ddTd_(r.name + ' (' + r.sku + ')') + ddTd_(ddNum_(r.short), 'right') + ddTd_(String(r.lines), 'right') + ddTd_(ddPct_(linePct), 'right') + '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;margin-bottom:1rem;"><tr>'
    + ddTh_('#', 'center') + ddTh_('Top 5 SKUs by units short') + ddTh_('Shortfall', 'right') + ddTh_('Lines', 'right') + ddTh_('Line adherence', 'right')
    + '</tr>' + body + '</table>';
}

function ddTopGpsTable_(rows) {
  var body = rows.map(function (r, i) {
    return '<tr>' + ddTd_(String(i + 1), 'center', 'font-weight:700;color:#087f6d;') + ddTd_(r.code) + ddTd_(r.facility) + ddTd_(ddNum_(r.short) + ' of ' + ddNum_(r.instructed), 'right') + ddTd_(ddPct_(r.pct), 'right') + '</tr>';
  }).join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;margin-bottom:1rem;"><tr>'
    + ddTh_('#', 'center') + ddTh_('Top 5 gate passes by units short') + ddTh_('Facility') + ddTh_('Shortfall', 'right') + ddTh_('Adherence', 'right')
    + '</tr>' + body + '</table>';
}

function ddAgingFacilityTable_(rowLabel, buckets, byBucketFacility, facilityTotals, grandTotal) {
  var head = '<tr>' + ddTh_(rowLabel) + DD_FACILITIES.map(function (f) { return ddTh_(f, 'right'); }).join('') + ddTh_('Total', 'right') + '</tr>';
  var body = buckets.map(function (b) {
    var perFac = byBucketFacility[b.key] || {};
    var rowTotal = 0;
    var cells = DD_FACILITIES.map(function (f) { var v = perFac[f] || 0; rowTotal += v; return v; });
    var flag = (b.key === '6to10' || b.key === 'gt10') && rowTotal > 0;
    var cellsHtml = cells.map(function (v) { return ddTd_(ddNum_(v), 'right', flag ? 'background-color:#fbe7e5;color:#b3261e;font-weight:700;' : ''); }).join('');
    return '<tr>' + ddTd_(b.label, 'left', 'font-weight:600;') + cellsHtml + ddTd_(ddNum_(rowTotal), 'right', flag ? 'background-color:#fbe7e5;color:#b3261e;font-weight:700;' : '') + '</tr>';
  }).join('');
  var totalsRow = '<tr>' + ddTd_('Facility totals', 'left', 'font-weight:700;background-color:#f4f8f6;')
    + DD_FACILITIES.map(function (f) { return ddTd_(ddNum_(facilityTotals[f] || 0), 'right', 'background-color:#f4f8f6;font-weight:700;'); }).join('')
    + ddTd_(ddNum_(grandTotal), 'right', 'background-color:#f4f8f6;font-weight:700;') + '</tr>';
  return '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;margin-bottom:0.5rem;">' + head + body + totalsRow + '</table>';
}

function ddQueueTable_(title, buckets, byBucketFacility, facilityTotals, grandTotal) {
  var titleRow = '<tr><th colspan="5" style="text-align:left;padding:0.3rem 0.1rem;color:#063a33;font-size:0.72rem;font-weight:700;">' + title + '</th></tr>';
  var head = '<tr>' + ddTh_('Age') + DD_FACILITIES.map(function (f) { return ddTh_(f, 'right'); }).join('') + ddTh_('Total', 'right') + '</tr>';
  var body = buckets.map(function (b) {
    var perFac = byBucketFacility[b.key] || {};
    var rowTotal = 0;
    var cellsHtml = DD_FACILITIES.map(function (f) { var v = perFac[f] || 0; rowTotal += v; return ddTd_(ddNum_(v), 'right'); }).join('');
    return '<tr>' + ddTd_(b.label, 'left', 'font-weight:600;') + cellsHtml + ddTd_(ddNum_(rowTotal), 'right') + '</tr>';
  }).join('');
  var totalsRow = '<tr>' + ddTd_('Total', 'left', 'font-weight:700;background-color:#f4f8f6;')
    + DD_FACILITIES.map(function (f) { return ddTd_(ddNum_(facilityTotals[f] || 0), 'right', 'background-color:#f4f8f6;font-weight:700;'); }).join('')
    + ddTd_(ddNum_(grandTotal), 'right', 'background-color:#f4f8f6;font-weight:700;') + '</tr>';
  return '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;margin-bottom:0.5rem;">' + titleRow + head + body + totalsRow + '</table>';
}

function ddSumByFacility_(byBucketFacility) {
  var out = {};
  Object.keys(byBucketFacility).forEach(function (bucketKey) {
    var perFac = byBucketFacility[bucketKey];
    Object.keys(perFac).forEach(function (f) { out[f] = (out[f] || 0) + perFac[f]; });
  });
  return out;
}

// ── Small formatting/plumbing helpers ────────────────────────────────

/** Plain 3-digit comma grouping (e.g. 1,791,966) — matches the proven draft's format exactly; deliberately not toLocaleString(), whose locale-data availability isn't guaranteed across Apps Script runtimes. */
function ddNum_(n) {
  var s = String(Math.round(n));
  var neg = s.charAt(0) === '-';
  if (neg) s = s.slice(1);
  var out = '';
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s.charAt(i);
  }
  return (neg ? '-' : '') + out;
}
function ddPct_(n) { return (Math.round(n * 100) / 100).toFixed(2) + '%'; }

function ddIsoDaysAgo_(now, days) {
  var d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return Utilities.formatDate(d, 'Asia/Kolkata', 'yyyy-MM-dd');
}

function ddLongDate_(dateObj) { return Utilities.formatDate(dateObj, 'Asia/Kolkata', 'dd MMM yyyy'); }

/** Same as ddLongDate_ but takes a yyyy-MM-dd string (from Supabase) instead of a Date, avoiding any timezone re-interpretation. */
function ddLongDateIso_(iso) {
  var parts = iso.split('-');
  return parts[2] + ' ' + DD_MONTH_ABBR[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
}

/** "02 Sep" — day-then-month, deliberately not toLocaleDateString (locale-dependent ordering), matching the app's own TrendChart formatter. */
function ddShortDate_(iso) {
  var parts = iso.split('-');
  return parts[2] + ' ' + DD_MONTH_ABBR[parseInt(parts[1], 10) - 1];
}

/** Pages through a Supabase table/query, same pattern as gpaFetchAllTasks_ in GatepassAdherenceCheck.gs. */
function ddFetchAll_(url, key, pathWithQuery) {
  var out = [];
  var offset = 0;
  var pageSize = 1000;
  var sep = pathWithQuery.indexOf('?') >= 0 ? '&' : '?';
  while (true) {
    var resp = UrlFetchApp.fetch(url + pathWithQuery + sep + 'limit=' + pageSize + '&offset=' + offset, {
      method: 'get',
      headers: { apikey: key, Authorization: 'Bearer ' + key },
      muteHttpExceptions: true,
    });
    if (resp.getResponseCode() >= 300) throw new Error('Fetch failed ' + resp.getResponseCode() + ': ' + resp.getContentText());
    var page = JSON.parse(resp.getContentText());
    out = out.concat(page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}
