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
  return labels.slice(-2).join('.');
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
  const nowSec = Date.now() / 1000;
  let scanned = 0, rewrote = 0, demotions = 0, failed = 0;
  const perSite = {};

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
  }

  await mergeCounters(rewrote, demotions, perSite);
  await appendHistory({ at: Date.now(), trigger, scanned, rewrote, demotions });

  const stats = { scanned, rewrote, demotions, failed, rewrites: rewrote };
  console.log(`[scoper] sweep (${trigger}): scanned ${scanned}, rewrote ${rewrote}, demoted ${demotions}`);
  return stats;
}

async function mergeCounters(deltaTightened, deltaDemotions, perSite) {
  const { cookieScopeCounters } = await chrome.storage.local.get('cookieScopeCounters');
  const prev = cookieScopeCounters || { tightened: 0, demotions: 0, sweeps: 0, lastSweep: 0, bySite: {} };
  const prevBySite = prev.bySite || {};
  for (const [etld1, delta] of Object.entries(perSite || {})) {
    const old = prevBySite[etld1] || { tightened: 0, demotions: 0 };
    prevBySite[etld1] = {
      tightened: old.tightened + delta.tightened,
      demotions: old.demotions + delta.demotions,
    };
  }
  await chrome.storage.local.set({
    cookieScopeCounters: {
      tightened: prev.tightened + deltaTightened,
      demotions: prev.demotions + deltaDemotions,
      sweeps: prev.sweeps + 1,
      lastSweep: Date.now(),
      bySite: prevBySite,
    },
  });
}

async function appendHistory(entry) {
  const { cookieScopeHistory } = await chrome.storage.local.get('cookieScopeHistory');
  const arr = Array.isArray(cookieScopeHistory) ? cookieScopeHistory.slice() : [];
  arr.unshift(entry);
  if (arr.length > HISTORY_MAX) arr.length = HISTORY_MAX;
  await chrome.storage.local.set({ cookieScopeHistory: arr });
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

self.scoperSweep = sweep;
self.scoperEnsureAlarm = ensureAlarm;
self.scoperEtld1Of = etld1Of;
self.SCOPER_PERIOD_CHOICES_MIN = PERIOD_CHOICES_MIN;
self.SCOPER_CAP_UNTRUSTED = CAP_UNTRUSTED;

console.log('[scoper] loaded · alarm=' + SCOPER_ALARM);
