"use strict";

// scoper.js — wearehere cookie scoper.
//
// Lineage: derived from the wearehere phase-0 POC that validated the
// alarm + sweep + rewrite cycle on this codebase (the run that logged
// "[scoper-poc] sweep N: scanned X, rewrote Y"). The wearecooked v5
// machinery (PSL parsing, seenSites 3p anchor, dedup gates) is dropped
// because the POC's simpler shape was proven and the wearecooked port
// stalled silently at message-handler time.
//
// Policy:
//   - Untrusted site                    -> cap 7d
//   - Trusted site (user-added)         -> cap 30d or 90d
//   - Cookie classified as tracker (OCD Marketing/Analytics)
//                                       -> session (kill on tab close)
//
// Storage shape:
//   cookieScopeCounters: { tightened, demotions, sweeps, lastSweep, bySite: { etld1: { tightened, demotions } } }
//   cookieScopeTrust:    { etld1: { capDays: 30|90, addedAt } }
//   cookieScopeSettings: { sweepPeriodMin: 15|60|240|720 }
//   cookieScopeHistory:  [{ at, trigger, scanned, rewrote, demotions }, ...]
//
// Depends on self.classifyCookie (from cookie-database.js) for tracker
// detection. Falls back gracefully if absent.

const SCOPER_ALARM = 'wearehere-scoper-sweep';
const PERIOD_CHOICES_MIN = [15, 60, 240, 720];
const DEFAULT_PERIOD_MIN = 60;
const FIRST_SWEEP_DELAY_MIN = 1;
const HISTORY_MAX = 50;
const SEC_PER_DAY = 86400;
// Windowed impact log — hourly buckets of cookies tightened/demoted, fed by
// BOTH the sweep and the realtime retrim flush. The Overview's "this period"
// numbers sum this (cookieScopeHistory only records sweeps, and realtime
// retrim — the dominant path — never reaches it, so a history-based window
// reads ~0). Bucketed by hour so size is bounded by time, not activity.
const IMPACT_LOG_KEY = 'cookieScopeImpactLog';
const IMPACT_LOG_MAX_HOURS = 33 * 24; // ~a month + slack; covers the longest window

const CAP_UNTRUSTED = 7;
const CAP_TRUSTED_DEFAULT = 30;
const CAP_TRUSTED_POWER = 90;

// Simple eTLD+1 — last two labels. Good enough for the trust list keying
// the user actually types (example.com, cnn.com). Trust list is user-
// curated, so a slightly imprecise key is acceptable; users adjust their
// input if mismatched.
function etld1Of(host) {
  if (!host) return null;
  const cleaned = host.startsWith('.') ? host.slice(1) : host;
  const labels = cleaned.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const lastTwo = labels.slice(-2).join('.');
  // self.WH_PUBLIC_SUFFIX defined in background.js (shared SW global); guard in
  // case load order ever changes — falls back to last-two-labels.
  if ((self.WH_PUBLIC_SUFFIX || {})[lastTwo] && labels.length >= 3) return labels.slice(-3).join('.');
  return lastTwo;
}

function buildSetDetails(cookie, capDays) {
  const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain;
  const details = {
    url: (cookie.secure ? 'https:' : 'http:') + '//' + host + cookie.path,
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    storeId: cookie.storeId,
  };
  if (capDays !== null) {
    details.expirationDate = Math.floor(Date.now() / 1000) + capDays * SEC_PER_DAY;
  }
  // __Host- requires Secure + path=/ + no Domain attribute. Skip otherwise.
  if (cookie.name.startsWith('__Host-')) {
    if (cookie.path !== '/' || !cookie.secure || cookie.domain.startsWith('.')) {
      return null;
    }
  } else if (cookie.domain.startsWith('.')) {
    details.domain = cookie.domain;
  }
  return details;
}

function setCookieAsync(details) {
  return new Promise((resolve) => {
    chrome.cookies.set(details, (result) => {
      if (chrome.runtime.lastError || !result) {
        resolve({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

async function loadTrust() {
  const { cookieScopeTrust } = await chrome.storage.local.get('cookieScopeTrust');
  return cookieScopeTrust || {};
}

async function loadSettings() {
  const { cookieScopeSettings } = await chrome.storage.local.get('cookieScopeSettings');
  const s = cookieScopeSettings || {};
  const p = PERIOD_CHOICES_MIN.includes(s.sweepPeriodMin) ? s.sweepPeriodMin : DEFAULT_PERIOD_MIN;
  return { sweepPeriodMin: p };
}

function decideCap(cookie, etld1, trust) {
  const classify = self.classifyCookie;
  if (classify) {
    const cls = classify(cookie.name);
    if (cls && (cls.category === 'Marketing' || cls.category === 'Analytics')) {
      return { cap: null, reason: 'tracker-demote' };
    }
  }
  const t = trust[etld1];
  if (t && (t.capDays === CAP_TRUSTED_DEFAULT || t.capDays === CAP_TRUSTED_POWER)) {
    return { cap: t.capDays, reason: 'trusted' };
  }
  return { cap: CAP_UNTRUSTED, reason: 'untrusted' };
}

async function sweep(trigger) {
  const cookies = await chrome.cookies.getAll({});
  const trust = await loadTrust();
  const domainCompany = await loadDomainCompanyMapForScoper();
  const nowSec = Date.now() / 1000;
  let scanned = 0, rewrote = 0, demotions = 0, failed = 0;
  const perSite = {};
  const perCompany = {};

  for (const c of cookies) {
    scanned++;
    const etld1 = etld1Of(c.domain);
    if (!etld1) continue;
    if (c.session) continue;

    const decision = decideCap(c, etld1, trust);
    if (decision.cap !== null) {
      const remainingDays = (c.expirationDate - nowSec) / SEC_PER_DAY;
      if (remainingDays <= decision.cap) continue;
    } else {
      if (!c.expirationDate) continue;
    }

    const details = buildSetDetails(c, decision.cap);
    if (!details) continue;
    const r = await setCookieAsync(details);
    if (!r.ok) { failed++; continue; }

    rewrote++;
    if (!perSite[etld1]) perSite[etld1] = { tightened: 0, demotions: 0 };
    perSite[etld1].tightened++;
    if (decision.reason === 'tracker-demote') {
      demotions++;
      perSite[etld1].demotions++;
    }
    const company = domainCompany[etld1];
    if (company) {
      const k = company.toLowerCase();
      if (!perCompany[k]) perCompany[k] = { name: company, tightened: 0 };
      perCompany[k].tightened++;
    }
  }

  await mergeCounters(rewrote, demotions, perSite, perCompany);
  await appendHistory({ at: Date.now(), trigger, scanned, rewrote, demotions });
  await recordImpact(rewrote, demotions);

  const stats = { scanned, rewrote, demotions, failed, rewrites: rewrote };
  console.log(`[scoper] sweep (${trigger}): scanned ${scanned}, rewrote ${rewrote}, demoted ${demotions}`);
  return stats;
}

async function mergeCounters(deltaTightened, deltaDemotions, perSite, perCompany) {
  return mergeCountersInternal(deltaTightened, deltaDemotions, perSite, perCompany, { isSweep: true });
}

// Serialize all counter merges through one chain. The cookieScopeCounters
// record is read-modify-written by both the periodic sweep and the
// realtime-retrim flush; a manual "sweep now" overlapping the alarm sweep
// (or a flush landing mid-sweep) otherwise interleaves get→set and the
// second writer clobbers the first, losing up to half the increments.
let counterWriteChain = Promise.resolve();
function mergeCountersInternal(deltaTightened, deltaDemotions, perSite, perCompany, opts) {
  const job = counterWriteChain.then(() =>
    mergeCountersUnsafe(deltaTightened, deltaDemotions, perSite, perCompany, opts)
  );
  // Swallow rejections in the chain so one failed merge doesn't wedge all
  // subsequent merges; the caller still sees its own rejection via job.
  counterWriteChain = job.catch(() => {});
  return job;
}

async function mergeCountersUnsafe(deltaTightened, deltaDemotions, perSite, perCompany, opts) {
  const isSweep = !!(opts && opts.isSweep);
  const { cookieScopeCounters } = await chrome.storage.local.get('cookieScopeCounters');
  const prev = cookieScopeCounters || { tightened: 0, demotions: 0, sweeps: 0, lastSweep: 0, bySite: {}, byCompany: {} };
  const prevBySite = prev.bySite || {};
  for (const [etld1, delta] of Object.entries(perSite || {})) {
    const old = prevBySite[etld1] || { tightened: 0, demotions: 0 };
    prevBySite[etld1] = {
      tightened: old.tightened + delta.tightened,
      demotions: old.demotions + delta.demotions,
    };
  }
  const prevByCompany = prev.byCompany || {};
  for (const [k, delta] of Object.entries(perCompany || {})) {
    const old = prevByCompany[k] || { name: delta.name, tightened: 0 };
    prevByCompany[k] = {
      name: delta.name || old.name,
      tightened: (old.tightened || 0) + (delta.tightened || 0),
    };
  }
  await chrome.storage.local.set({
    cookieScopeCounters: {
      tightened: prev.tightened + deltaTightened,
      demotions: prev.demotions + deltaDemotions,
      sweeps: prev.sweeps + (isSweep ? 1 : 0),
      lastSweep: isSweep ? Date.now() : (prev.lastSweep || 0),
      bySite: prevBySite,
      byCompany: prevByCompany,
    },
  });
}

// Cached cookie-domain → company map. Populated by background.js's
// harvest from detect-cooked items (keyed by eTLD+1). We read it once
// per sweep and cache it for the realtime onChanged path; storage
// listener below refreshes the cache when background writes a new
// version. Cookies whose domain hasn't been observed via cooked stay
// unattributed in byCompany — the lifetime total in `tightened` is
// still complete.
let domainCompanyCache = null;
async function loadDomainCompanyMapForScoper() {
  if (domainCompanyCache) return domainCompanyCache;
  try {
    const { cookieDomainCompanyMap } = await chrome.storage.local.get('cookieDomainCompanyMap');
    domainCompanyCache = (cookieDomainCompanyMap && typeof cookieDomainCompanyMap === 'object')
      ? cookieDomainCompanyMap : {};
  } catch { domainCompanyCache = {}; }
  return domainCompanyCache;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cookieDomainCompanyMap) {
    domainCompanyCache = changes.cookieDomainCompanyMap.newValue || {};
  }
});
// Warm the cache at load so the realtime onChanged path can attribute
// trimmed-per-company before the first sweep runs. Without this, retrims
// fired between SW boot and the first alarm/manual sweep land in bySite
// but not byCompany.
loadDomainCompanyMapForScoper();

async function appendHistory(entry) {
  const { cookieScopeHistory } = await chrome.storage.local.get('cookieScopeHistory');
  const arr = Array.isArray(cookieScopeHistory) ? cookieScopeHistory.slice() : [];
  arr.unshift(entry);
  if (arr.length > HISTORY_MAX) arr.length = HISTORY_MAX;
  await chrome.storage.local.set({ cookieScopeHistory: arr });
}

// Add to the current hour bucket of the windowed impact log. Sweep and the
// realtime flush both call this; their events are disjoint (different
// cookies, different times), so summing is correct — no double count.
// Serialized through its own chain so a sweep and a flush landing together
// can't read-modify-write over each other.
let impactWriteChain = Promise.resolve();
function recordImpact(tightened, demotions) {
  if (!tightened && !demotions) return Promise.resolve();
  const job = impactWriteChain.then(async () => {
    const stored = await chrome.storage.local.get(IMPACT_LOG_KEY);
    const log = (stored[IMPACT_LOG_KEY] && typeof stored[IMPACT_LOG_KEY] === 'object') ? stored[IMPACT_LOG_KEY] : {};
    const hour = Math.floor(Date.now() / 3_600_000);
    const cur = log[hour] || { t: 0, d: 0 };
    cur.t += tightened || 0;
    cur.d += demotions || 0;
    log[hour] = cur;
    const minHour = hour - IMPACT_LOG_MAX_HOURS;
    for (const k in log) { if (+k < minHour) delete log[k]; }
    await chrome.storage.local.set({ [IMPACT_LOG_KEY]: log });
  });
  impactWriteChain = job.catch(() => {});
  return job;
}

async function ensureAlarm() {
  const { sweepPeriodMin } = await loadSettings();
  chrome.alarms.create(SCOPER_ALARM, {
    delayInMinutes: FIRST_SWEEP_DELAY_MIN,
    periodInMinutes: sweepPeriodMin,
  });
  console.log('[scoper] alarm set · period=' + sweepPeriodMin + 'min · first fire in ' + FIRST_SWEEP_DELAY_MIN + 'min');
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === SCOPER_ALARM) sweep('alarm');
});

chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); });
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); });

// Re-create the alarm on every SW boot — cheap idempotent call, and
// covers the case where onInstalled/onStartup already fired before this
// script loaded.
ensureAlarm();

// =============================================================================
// Auto-retrim: cookies.onChanged listener
//
// Periodic sweep is the safety net; this is the realtime arm. Sites like
// Google re-issue auth cookies on virtually every API request with multi-
// hundred-day expirations. Without this listener the cookie sits at 400d
// between sweep alarms, and if the browser closes during that window the
// full lifetime is persisted. The listener re-trims as fast as the site
// re-sets, so the steady-state cookie lifetime is the cap, not whatever
// the site wants.
//
// Ping-pong protection: our own cookies.set fires onChanged with
// cause='explicit'. The at-or-below-cap gate exits early on those events
// so we never re-trim our own write.
//
// Throughput: per-event work is one map lookup + one date compare + an
// early exit for already-trimmed cookies. Real writes only happen when a
// site genuinely re-issues above the cap. Counter increments accumulate
// in memory and flush to storage at most once every 5s to keep storage
// I/O bounded on busy sites.
// =============================================================================

let trustCache = null;
async function getTrustCached() {
  if (trustCache !== null) return trustCache;
  const { cookieScopeTrust } = await chrome.storage.local.get('cookieScopeTrust');
  trustCache = cookieScopeTrust || {};
  return trustCache;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.cookieScopeTrust) {
    trustCache = changes.cookieScopeTrust.newValue || {};
  }
});

let pendingRetrim = { tightened: 0, demotions: 0, bySite: {}, byCompany: {} };
let pendingFlushTimer = null;
const RETRIM_FLUSH_MS = 5000;

function queueRetrim(etld1, isDemote) {
  pendingRetrim.tightened++;
  if (isDemote) pendingRetrim.demotions++;
  const b = pendingRetrim.bySite[etld1] || { tightened: 0, demotions: 0 };
  b.tightened++;
  if (isDemote) b.demotions++;
  pendingRetrim.bySite[etld1] = b;
  // Cached map is populated by background.js's cooked harvest; first
  // few real-time retrims after a fresh install may not resolve a
  // company yet, which is fine — they accrue to bySite, just not to
  // byCompany. Cache is refreshed via the storage listener above.
  const company = domainCompanyCache && domainCompanyCache[etld1];
  if (company) {
    const k = company.toLowerCase();
    if (!pendingRetrim.byCompany[k]) pendingRetrim.byCompany[k] = { name: company, tightened: 0 };
    pendingRetrim.byCompany[k].tightened++;
  }
  if (pendingFlushTimer) return;
  pendingFlushTimer = setTimeout(flushPendingRetrim, RETRIM_FLUSH_MS);
}

async function flushPendingRetrim() {
  pendingFlushTimer = null;
  const delta = pendingRetrim;
  pendingRetrim = { tightened: 0, demotions: 0, bySite: {}, byCompany: {} };
  if (!delta.tightened && !delta.demotions) return;
  await mergeCountersInternal(delta.tightened, delta.demotions, delta.bySite, delta.byCompany, { isSweep: false });
  await recordImpact(delta.tightened, delta.demotions);
}

chrome.cookies.onChanged.addListener(async (info) => {
  // Removals (expired, evicted, overwrite-of-old, explicit-delete) are not
  // our concern — we only re-tighten cookies the site has just *set*.
  if (info.removed) return;
  // cause='explicit' covers both site-set and our own cookies.set. Other
  // causes (evicted, expired, overwrite) only fire with removed=true above.
  if (info.cause !== 'explicit') return;
  const c = info.cookie;
  if (c.session) return;
  if (!c.expirationDate) return;
  const etld1 = etld1Of(c.domain);
  if (!etld1) return;

  const trust = await getTrustCached();
  const decision = decideCap(c, etld1, trust);
  const nowSec = Date.now() / 1000;

  if (decision.cap !== null) {
    const remainingDays = (c.expirationDate - nowSec) / SEC_PER_DAY;
    // 0.1d (~2.4h) tolerance absorbs float drift and rounded site values
    // so we don't bounce-rewrite a cookie we just trimmed.
    if (remainingDays <= decision.cap + 0.1) return;
  }
  // decision.cap === null = tracker-demote. Always re-trim non-session
  // trackers; their existence above session-lifetime is the whole problem.

  const details = buildSetDetails(c, decision.cap);
  if (!details) return;
  const r = await setCookieAsync(details);
  if (!r.ok) return;

  queueRetrim(etld1, decision.reason === 'tracker-demote');
});

self.scoperSweep = sweep;
self.scoperEnsureAlarm = ensureAlarm;
self.scoperEtld1Of = etld1Of;
self.SCOPER_PERIOD_CHOICES_MIN = PERIOD_CHOICES_MIN;
self.SCOPER_CAP_UNTRUSTED = CAP_UNTRUSTED;

console.log('[scoper] loaded · alarm=' + SCOPER_ALARM);
