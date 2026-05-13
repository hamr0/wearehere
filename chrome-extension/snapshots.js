"use strict";

// snapshots.js — rolled-up aggregates per time window. Overview tab reads
// these instead of refiltering visitHistory on every render.
//
// Storage shape (key: 'windowSnapshots'):
//   {
//     computedAt:  ms,
//     today:       Window,
//     week:        Window,
//     month:       Window,
//     prior: { today: Window, week: Window, month: Window }
//   }
//
//   Window = {
//     range:           { start, end },                // ms cutoffs (rolling)
//     visitsN:         int,
//     sites:           [etld1, ...],                  // unique
//     avgScore:        int,
//     contacts:        int,                           // sum of watcher hits
//     watchers:        { [lowerName]: { name, hits, mech: {cookies, pixels, clicks, deviceId} } },
//     reachPct:        { [lowerName]: int },          // % of visits seeing this watcher
//     brokers:         { [lowerName]: { name, hits } },
//     avgScoreBySite:  { [etld1]: int },
//     latestBySite:    { [etld1]: { cookieCount, scoperTightened } },
//     typing:          { fields, visits },
//   }
//
// Recompute is cheap on a 1000-record history (single pass per window).
// We pay for it at most every STALE_MS (5 min) on append, and on the
// 60-min alarm tick.

const SNAPSHOTS_KEY = 'windowSnapshots';
const SNAPSHOT_STALE_MS = 5 * 60 * 1000;
const SNAPSHOT_ALARM = 'snapshots:recompute';

const DAY = 24 * 60 * 60 * 1000;
const WINDOWS = [
  { name: 'today', ms: DAY },
  { name: 'week',  ms: 7 * DAY },
  { name: 'month', ms: 30 * DAY },
];
// 'all' is supported by the on-the-fly aggregator (getWindowAggregates),
// not the stored snapshot — there's no useful "prior all-time" to diff
// against, and the cur set is just the entire history.

function emptyWindow(start, end) {
  return {
    range: { start, end },
    visitsN: 0,
    sites: [],
    avgScore: 0,
    contacts: 0,
    watchers: {},
    reachPct: {},
    brokers: {},
    avgScoreBySite: {},
    latestBySite: {},
    typing: { fields: 0, visits: 0 },
  };
}

// Aggregate one window from a pre-filtered visit array. visits MUST be
// newest-first (matches visitHistory ordering) so latestBySite picks the
// right record.
function aggregateWindow(visits, start, end) {
  const w = emptyWindow(start, end);
  if (!visits.length) return w;

  w.visitsN = visits.length;

  const sites = new Set();
  let scoreSum = 0;
  const watcherHits = {};        // lowerName -> { name, hits, mech }
  const brokerHits = {};         // lowerName -> { name, hits }
  const scoreSumsBySite = {};    // etld1 -> sum
  const scoreCountsBySite = {};  // etld1 -> count
  let typingFields = 0;
  let typingVisits = 0;

  for (const v of visits) {
    if (v.etld1) sites.add(v.etld1);
    scoreSum += v.score || 0;

    if (v.etld1) {
      scoreSumsBySite[v.etld1] = (scoreSumsBySite[v.etld1] || 0) + (v.score || 0);
      scoreCountsBySite[v.etld1] = (scoreCountsBySite[v.etld1] || 0) + 1;
      // Newest-first iteration: keep the *first* entry seen per site.
      if (!w.latestBySite[v.etld1]) {
        w.latestBySite[v.etld1] = {
          cookieCount: v.cookieCount || 0,
          scoperTightened: v.scoperTightened || 0,
        };
      }
    }

    const wm = v.watcherMech || {};
    const seenInVisit = new Set();
    for (const name of (v.watchers || [])) {
      const k = name.toLowerCase();
      if (!watcherHits[k]) {
        watcherHits[k] = { name, hits: 0, mech: { cookies: 0, pixels: 0, clicks: 0, deviceId: 0 } };
      }
      // Reach counts each *visit* with this watcher, not each mention.
      if (!seenInVisit.has(k)) {
        watcherHits[k].hits++;
        seenInVisit.add(k);
        w.contacts++;
      }
      const m = wm[name];
      if (m) {
        watcherHits[k].mech.cookies  += m.cookies  || 0;
        watcherHits[k].mech.pixels   += m.pixels   || 0;
        watcherHits[k].mech.clicks   += m.clicks   || 0;
        watcherHits[k].mech.deviceId += m.deviceId || 0;
      }
    }

    for (const b of (v.brokers || [])) {
      const k = b.toLowerCase();
      if (!brokerHits[k]) brokerHits[k] = { name: b, hits: 0 };
      brokerHits[k].hits++;
    }

    const mech = v.mechanisms || {};
    if (mech.typing) { typingFields += mech.typing; typingVisits++; }
  }

  w.sites = Array.from(sites);
  w.avgScore = Math.round(scoreSum / visits.length);
  w.watchers = watcherHits;
  w.brokers = brokerHits;
  w.typing = { fields: typingFields, visits: typingVisits };

  // reachPct
  for (const k of Object.keys(watcherHits)) {
    w.reachPct[k] = Math.round((watcherHits[k].hits / visits.length) * 100);
  }
  // avgScoreBySite
  for (const s of Object.keys(scoreSumsBySite)) {
    w.avgScoreBySite[s] = Math.round(scoreSumsBySite[s] / scoreCountsBySite[s]);
  }

  return w;
}

function computeSnapshots(history) {
  const arr = Array.isArray(history) ? history : [];
  const now = Date.now();
  const out = { computedAt: now, today: null, week: null, month: null, prior: {} };

  for (const { name, ms } of WINDOWS) {
    const curStart = now - ms;
    const prevStart = now - 2 * ms;
    const cur = arr.filter((v) => v.at >= curStart);
    const prev = arr.filter((v) => v.at >= prevStart && v.at < curStart);
    out[name] = aggregateWindow(cur, curStart, now);
    out.prior[name] = aggregateWindow(prev, prevStart, curStart);
  }

  return out;
}

async function getSnapshots() {
  const { [SNAPSHOTS_KEY]: snaps } = await chrome.storage.local.get(SNAPSHOTS_KEY);
  return snaps || null;
}

async function recomputeSnapshots() {
  const { visitHistory } = await chrome.storage.local.get('visitHistory');
  const snaps = computeSnapshots(visitHistory);
  await chrome.storage.local.set({ [SNAPSHOTS_KEY]: snaps });
  return snaps;
}

// Recompute only if the cached snapshot is older than SNAPSHOT_STALE_MS.
// Called after each visitsAppend so the dashboard sees fresh aggregates
// without recomputing on every page-load.
async function recomputeIfStale() {
  const snaps = await getSnapshots();
  if (snaps && (Date.now() - (snaps.computedAt || 0)) < SNAPSHOT_STALE_MS) return snaps;
  return recomputeSnapshots();
}

// Return { cur, prev } aggregates for a named window. Reads the stored
// snapshot for today/week/month (recomputes if stale); for 'all', builds
// cur from the whole history live and returns prev=null (no useful
// "before all-time" to diff against).
async function getWindowAggregates(name) {
  if (name === 'all') {
    const { visitHistory } = await chrome.storage.local.get('visitHistory');
    const arr = Array.isArray(visitHistory) ? visitHistory : [];
    return { cur: aggregateWindow(arr, 0, Date.now()), prev: null };
  }
  const snaps = await recomputeIfStale();
  const cur = snaps && snaps[name];
  const prev = snaps && snaps.prior && snaps.prior[name];
  return { cur: cur || null, prev: prev || null };
}

self.SNAPSHOTS_KEY = SNAPSHOTS_KEY;
self.SNAPSHOT_ALARM = SNAPSHOT_ALARM;
self.snapshotsCompute = computeSnapshots;
self.snapshotsGet = getSnapshots;
self.snapshotsRecompute = recomputeSnapshots;
self.snapshotsRecomputeIfStale = recomputeIfStale;
self.snapshotsGetWindow = getWindowAggregates;

console.log('[snapshots] loaded · windows=' + WINDOWS.map((w) => w.name).join(','));
