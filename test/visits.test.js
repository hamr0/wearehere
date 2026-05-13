// visits.js — compactVisit schema + appendVisit ring buffer behavior.
// These tests assert the v4 visit-record shape stays stable as more
// renderers (snapshots, report.js) depend on it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorkerModule, makeChromeStub, plain } from './_helpers.js';

function makeReport(overrides = {}) {
  return {
    site: 'nytimes.com',
    url: 'https://www.nytimes.com/article',
    verdict: { score: 47 },
    cookies: { snoops: 12, thirdParty: 31 },
    trackers: {
      pixels: 4, beacons: 2, hiddenIframes: 1,
      companies: [
        { name: 'Google',  viaCookies: 3, viaPixels: 2, viaClicks: 1, viaDeviceId: 4 },
        { name: 'Meta',    viaCookies: 1, viaPixels: 3 },
        { name: 'Unknown', viaCookies: 0 }, // edge: no signals beyond presence
      ],
    },
    fingerprinting: { techniques: 5 },
    forms: { fieldCount: 3 },
    linkTracking: { tracked: 8 },
    network: { brokerCount: 2, brokers: [{ name: 'Acxiom' }, { brokerName: 'Oracle' }] },
    tos: { found: true, score: 18 },
    localData: { suspicious: 4 },
    ...overrides,
  };
}

test('compactVisit returns the v4 record shape', async () => {
  const ctx = loadServiceWorkerModule('visits.js');
  // visits.js exposes appendVisit + getVisits, but compactVisit is local
  // scope. We test it indirectly: appendVisit calls compactVisit, then
  // we read back the stored record.
  await ctx.visitsAppend(makeReport());
  const all = await ctx.visitsGet('all');
  assert.equal(all.length, 1);
  const v = all[0];

  assert.equal(v.etld1, 'nytimes.com');
  assert.equal(v.url, 'https://www.nytimes.com/article');
  assert.equal(v.score, 47);
  assert.equal(v.tosScore, 18);
  assert.equal(v.cookieCount, 31);
  assert.equal(v.storedIds, 4);
  assert.equal(v.scoperTightened, 0); // no scoper data in storage stub

  // Mechanisms: cookies + pixels(=4+2+1) + deviceId + typing + clicks
  assert.deepEqual(plain(v.mechanisms), { cookies: 12, pixels: 7, deviceId: 5, typing: 3, clicks: 8 });

  // Brokers preferred from the typed list (with name and brokerName variants).
  assert.deepEqual(plain(v.brokers), ['Acxiom', 'Oracle']);
  assert.equal(v.brokerCount, 2);

  // Watchers preserve the company name list; watcherMech carries the
  // four per-company attribution counters.
  assert.deepEqual(plain(v.watchers), ['Google', 'Meta', 'Unknown']);
  assert.deepEqual(plain(v.watcherMech.Google), { cookies: 3, pixels: 2, clicks: 1, deviceId: 4 });
  assert.deepEqual(plain(v.watcherMech.Meta),   { cookies: 1, pixels: 3, clicks: 0, deviceId: 0 });
});

test('compactVisit drops records without a site (no etld1)', async () => {
  const ctx = loadServiceWorkerModule('visits.js');
  await ctx.visitsAppend({}); // empty report
  await ctx.visitsAppend({ site: 'localhost' }); // single-label, no etld1
  const all = await ctx.visitsGet('all');
  assert.equal(all.length, 0);
});

test('appendVisit ring-buffers at VISIT_HISTORY_MAX', async () => {
  const ctx = loadServiceWorkerModule('visits.js');
  // The constant lives in source; assert behavior at the cap.
  // We append cap+5 visits and expect the buffer to stay at cap, with
  // the newest visit at index 0 (unshift semantics).
  const cap = 1000;
  for (let i = 0; i < cap + 5; i++) {
    await ctx.visitsAppend({ ...makeReport(), site: `site${i}.com` });
  }
  const all = await ctx.visitsGet('all');
  assert.equal(all.length, cap);
  assert.equal(all[0].etld1, `site${cap + 4}.com`);
});

test('getVisits window filter is rolling, newest-first', async () => {
  const chrome = makeChromeStub();
  const ctx = loadServiceWorkerModule('visits.js', { chromeStub: chrome });

  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const fixture = [
    { at: now,                etld1: 'fresh.com',   score: 10 },
    { at: now - 6 * 60 * 60 * 1000, etld1: 'today.com', score: 20 },
    { at: now - 3 * DAY,      etld1: 'thisweek.com', score: 30 },
    { at: now - 10 * DAY,     etld1: 'thismonth.com', score: 40 },
    { at: now - 60 * DAY,     etld1: 'older.com',   score: 50 },
  ];
  await chrome.storage.local.set({ visitHistory: fixture });

  assert.deepEqual(plain((await ctx.visitsGet('today')).map((v) => v.etld1)), ['fresh.com', 'today.com']);
  assert.deepEqual(plain((await ctx.visitsGet('week')).map((v) => v.etld1)), ['fresh.com', 'today.com', 'thisweek.com']);
  assert.deepEqual(plain((await ctx.visitsGet('month')).map((v) => v.etld1)), ['fresh.com', 'today.com', 'thisweek.com', 'thismonth.com']);
  assert.equal((await ctx.visitsGet('all')).length, 5);
});

test('clearVisits wipes the buffer', async () => {
  const ctx = loadServiceWorkerModule('visits.js');
  await ctx.visitsAppend(makeReport());
  assert.equal((await ctx.visitsGet('all')).length, 1);
  await ctx.visitsClear();
  assert.equal((await ctx.visitsGet('all')).length, 0);
});
