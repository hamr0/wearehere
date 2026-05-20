"use strict";

// visits.js — per-visit snapshot history. Persists a compact record of
// each completed visit so Overview + Watchers cross-session blocks have
// real data to render.
//
// Storage shape:
//   visitHistory: [
//     {
//       at:          timestamp (ms)
//       etld1:       'nytimes.com'
//       url:         'https://www.nytimes.com/'
//       score:       0..100  (verdict score)
//       tosScore:    0..100 | null
//       brokerCount: int
//       brokers:     [name, ...] (top 10)
//       watchers:    [name, ...] (top 10 company names)
//       mechanisms:  { cookies, pixels, deviceId, typing, clicks } counts
//       storedIds:   int (localData.suspicious)
//       blurredSurfaces: int (fingerprint surfaces blurred this visit; 0 if off)
//     }, ...
//   ]
//
// Ring-buffered at VISIT_HISTORY_MAX entries. Snapshots are taken on the
// natural visit boundaries: tab close + domain change in same tab.
// buildReport(tabData) is the canonical source — visits.js doesn't
// duplicate detection logic, it just compacts the report.

const VISIT_HISTORY_MAX = 1000;
const VISIT_HISTORY_KEY = 'visitHistory';

// Blur-firing activity log for the privacy guard "Recent activity" block.
// One event per visit where blur was active and surfaces were touched.
const FARBLER_HISTORY_MAX = 50;

// Same simple eTLD+1 as the scoper — last two labels. Good enough for
// per-visit keying. PSL would be more precise but the visit timeline is
// user-curated context, not policy; a slightly imprecise group is fine.
function visitEtld1(host) {
  if (!host) return null;
  const cleaned = host.startsWith('.') ? host.slice(1) : host;
  const labels = cleaned.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join('.');
}

// Build a compact record from a full report. Caller passes the live
// report (from buildReport) so we don't duplicate detection logic.
function compactVisit(report) {
  if (!report || !report.site) return null;
  const cookies = report.cookies || {};
  const trackers = report.trackers || {};
  const fp = report.fingerprinting || {};
  const forms = report.forms || {};
  const links = report.linkTracking || {};
  const network = report.network || {};
  const tos = report.tos || {};
  const local = report.localData || {};

  // Watchers: names only for back-compat. watcherMech stores the four
  // mechanisms we can attribute per-company today (cookies + pixels +
  // clicks + device-id, from buildReport's trackerCompanies). typing
  // remains site-level — detect-silent.js measures form-field exposure,
  // not per-script keystroke observation.
  const companyArr = Array.isArray(trackers.companies) ? trackers.companies.slice(0, 10) : [];
  const watchers = companyArr.map((c) => c.name).filter(Boolean);
  const watcherMech = {};
  for (const c of companyArr) {
    if (!c.name) continue;
    watcherMech[c.name] = {
      cookies: c.viaCookies || 0,
      pixels: c.viaPixels || 0,
      clicks: c.viaClicks || 0,
      deviceId: c.viaDeviceId || 0,
    };
  }

  // Brokers: prefer the typed list if present (added by getFullReport
  // resolver), fall back to count when only the count was kept.
  const brokers = Array.isArray(network.brokers)
    ? network.brokers.slice(0, 10).map((b) => b.name || b.brokerName).filter(Boolean)
    : [];

  const pixelsN = (trackers.pixels || 0) + (trackers.beacons || 0) + (trackers.hiddenIframes || 0);

  return {
    at: Date.now(),
    etld1: visitEtld1(report.site),
    url: report.url || '',
    score: (report.verdict && report.verdict.score) || 0,
    tosScore: (tos.found && typeof tos.score === 'number') ? tos.score : null,
    brokerCount: brokers.length || network.brokerCount || 0,
    brokers,
    watchers,
    watcherMech,
    mechanisms: {
      cookies: cookies.snoops || 0,
      pixels: pixelsN,
      deviceId: fp.techniques || 0,
      typing: forms.fieldCount || 0,
      clicks: links.tracked || 0,
    },
    // Raw third-party cookie count — used by the "cookies grew" event
    // (per-site delta between adjacent visits).
    cookieCount: cookies.thirdParty || 0,
    storedIds: local.suspicious || 0,
  };
}

// Serialize appends through a promise chain. Without this, two
// near-simultaneous tab closes both `get → unshift → set` from the
// same starting array, and the second `set` clobbers the first — one
// visit is silently lost. Chaining keeps read-modify-write atomic.
let appendChain = Promise.resolve();
async function appendVisit(report) {
  const record = compactVisit(report);
  if (!record || !record.etld1) return;

  const job = appendChain.then(async () => {
    try {
      const { cookieScopeCounters } = await chrome.storage.local.get('cookieScopeCounters');
      const bySite = cookieScopeCounters && cookieScopeCounters.bySite;
      const here = bySite && bySite[record.etld1];
      record.scoperTightened = (here && here.tightened) || 0;
    } catch (e) { record.scoperTightened = 0; }

    // Credit per-company lifetime "Blurred" surfaces. After detect-
    // watched's unique-API fix, watcherMech[name].deviceId is the count
    // of distinct fingerprint APIs the company's scripts touched on this
    // visit. Summing it into the lifetime counter at visit boundaries
    // matches the Watchers tab's "lifetime regardless of window" rule.
    try {
      if (self.recordBlurredByCompany) {
        const perCompany = {};
        for (const [name, m] of Object.entries(record.watcherMech || {})) {
          if (m && m.deviceId > 0) perCompany[name] = m.deviceId;
        }
        if (Object.keys(perCompany).length) await self.recordBlurredByCompany(perCompany);
      }
    } catch (e) { /* best-effort */ }

    // Blur-firing event for the Recent activity log. Gated on blur actually
    // being active for this site — notify() fires on detection regardless of
    // farble state, so resolve the effective mode (override beats default)
    // and skip logging "blur active" when the site is off. Serialized in the
    // append chain, so no race on farblerHistory.
    try {
      const fpMethod = ((report.fingerprinting && report.fingerprinting.methods) || [])
        .find((m) => m.technique === 'fingerprint');
      const apis = (fpMethod && fpMethod.apis) || [];
      if (apis.length) {
        const { farblerSettings, defaultBlurMode } = await chrome.storage.local.get(['farblerSettings', 'defaultBlurMode']);
        const ov = farblerSettings && farblerSettings[record.etld1];
        const mode = (ov && (ov.mode === 'off' || ov.mode === 'stable')) ? ov.mode : (defaultBlurMode || 'per-tab');
        // Stash the windowed-blur input on the visit record (0 when blur was
        // off here) so Overview can sum surfaces blurred per time window from
        // visitHistory — more accurate than the 50-capped farblerHistory.
        record.blurredSurfaces = (mode !== 'off') ? apis.length : 0;
        if (mode !== 'off') {
          const fam = {};
          for (const a of apis) {
            const f = (typeof self.farbleFamilyOf === 'function') ? self.farbleFamilyOf(a) : 'screennav';
            fam[f] = (fam[f] || 0) + 1;
          }
          const families = Object.keys(fam).sort((x, y) => fam[y] - fam[x]);
          const { farblerHistory } = await chrome.storage.local.get('farblerHistory');
          const arr = Array.isArray(farblerHistory) ? farblerHistory.slice() : [];
          arr.unshift({ at: record.at, site: record.etld1, surfaces: apis.length, families, mode });
          if (arr.length > FARBLER_HISTORY_MAX) arr.length = FARBLER_HISTORY_MAX;
          await chrome.storage.local.set({ farblerHistory: arr });
        }
      }
    } catch (e) { /* best-effort */ }

    const { visitHistory } = await chrome.storage.local.get(VISIT_HISTORY_KEY);
    const arr = Array.isArray(visitHistory) ? visitHistory.slice() : [];
    arr.unshift(record);
    if (arr.length > VISIT_HISTORY_MAX) arr.length = VISIT_HISTORY_MAX;
    await chrome.storage.local.set({ [VISIT_HISTORY_KEY]: arr });
  });
  // Swallow rejections in the chain so a single failed append doesn't
  // permanently block all subsequent appends.
  appendChain = job.catch(() => {});
  return job;
}

// Window filter. `null` returns everything.
function visitWindowMs(name) {
  const DAY = 24 * 60 * 60 * 1000;
  switch (name) {
    case 'today': return DAY;
    case 'week':  return 7 * DAY;
    case 'month': return 30 * DAY;
    case 'all':
    default:      return null;
  }
}

async function getVisits(windowName) {
  const { visitHistory } = await chrome.storage.local.get(VISIT_HISTORY_KEY);
  const arr = Array.isArray(visitHistory) ? visitHistory : [];
  const ms = visitWindowMs(windowName);
  if (ms == null) return arr;
  const cutoff = Date.now() - ms;
  return arr.filter((v) => v.at >= cutoff);
}

async function clearVisits() {
  await chrome.storage.local.set({ [VISIT_HISTORY_KEY]: [] });
}

self.visitsAppend = appendVisit;
self.visitsGet = getVisits;
self.visitsClear = clearVisits;
self.VISIT_HISTORY_KEY = VISIT_HISTORY_KEY;

console.log('[visits] loaded · ring=' + VISIT_HISTORY_MAX);
