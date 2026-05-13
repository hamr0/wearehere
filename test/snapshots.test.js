// snapshots.js — window-aggregate computation. These tests pin the
// shape report.js depends on (sites/visitsN/avgScore/watchers/reachPct/
// brokers/avgScoreBySite/latestBySite/typing) and the rolling-window
// math (today/week/month + prior pair).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorkerModule, makeChromeStub, plain } from './_helpers.js';

const DAY = 24 * 60 * 60 * 1000;

function visit(overrides = {}) {
  return {
    at: Date.now(),
    etld1: 'a.com',
    url: 'https://a.com/',
    score: 30,
    tosScore: null,
    cookieCount: 5,
    scoperTightened: 0,
    brokers: [],
    watchers: [],
    watcherMech: {},
    mechanisms: { cookies: 0, pixels: 0, deviceId: 0, typing: 0, clicks: 0 },
    storedIds: 0,
    ...overrides,
  };
}

test('aggregateWindow on empty input returns the empty shape', () => {
  const ctx = loadServiceWorkerModule('snapshots.js');
  const out = ctx.snapshotsCompute([]);
  // Shape sanity: today/week/month + prior triplet, all zero-visits.
  for (const k of ['today', 'week', 'month']) {
    assert.equal(out[k].visitsN, 0);
    assert.deepEqual(plain(out[k].sites), []);
    assert.deepEqual(plain(out.prior[k].sites), []);
  }
});

test('aggregateWindow rolls up watchers, brokers, score per window', () => {
  const ctx = loadServiceWorkerModule('snapshots.js');
  const now = Date.now();
  const history = [
    // today (within 1d)
    visit({
      at: now,
      etld1: 'cnn.com', score: 60, cookieCount: 31, scoperTightened: 12,
      watchers: ['Google', 'Meta'],
      watcherMech: { Google: { cookies: 3, pixels: 2, clicks: 0, deviceId: 1 }, Meta: { cookies: 1, pixels: 4 } },
      brokers: ['Acxiom'],
      mechanisms: { cookies: 4, pixels: 6, deviceId: 1, typing: 2, clicks: 0 },
    }),
    visit({
      at: now - 3 * 60 * 60 * 1000,
      etld1: 'cnn.com', score: 40, cookieCount: 22, scoperTightened: 8,
      watchers: ['Google'],
      watcherMech: { Google: { cookies: 2, pixels: 1, clicks: 0, deviceId: 0 } },
      brokers: ['Acxiom'],
      mechanisms: { cookies: 2, pixels: 1, deviceId: 0, typing: 0, clicks: 0 },
    }),
    // earlier this week
    visit({ at: now - 3 * DAY, etld1: 'nyt.com', score: 20, watchers: ['Google'], watcherMech: { Google: { cookies: 1 } } }),
    // last week (prior window for 'week')
    visit({ at: now - 8 * DAY,  etld1: 'priorsite.com', score: 70, watchers: ['Meta'] }),
    visit({ at: now - 10 * DAY, etld1: 'priorsite.com', score: 50, watchers: ['Meta'] }),
  ];
  const snap = ctx.snapshotsCompute(history);

  // 'today': two visits, both cnn.com
  assert.equal(snap.today.visitsN, 2);
  assert.deepEqual(plain(snap.today.sites), ['cnn.com']);
  assert.equal(snap.today.avgScore, 50);             // (60+40)/2
  assert.equal(snap.today.watchers.google.hits, 2);  // both visits saw Google
  assert.equal(snap.today.watchers.meta.hits, 1);    // only the first visit
  assert.equal(snap.today.reachPct.google, 100);
  assert.equal(snap.today.reachPct.meta, 50);
  assert.equal(snap.today.brokers.acxiom.hits, 2);
  // latestBySite picks the *newest* per site (newest-first input).
  assert.equal(snap.today.latestBySite['cnn.com'].cookieCount, 31);
  assert.equal(snap.today.latestBySite['cnn.com'].scoperTightened, 12);
  assert.equal(snap.today.typing.fields, 2);
  assert.equal(snap.today.typing.visits, 1);
  // contacts = sum of distinct watcher-per-visit firings (Google×2 + Meta×1)
  assert.equal(snap.today.contacts, 3);

  // 'week': adds nyt.com
  assert.equal(snap.week.visitsN, 3);
  assert.equal(snap.week.sites.length, 2);
  // 'week' prior: priorsite.com twice
  assert.equal(snap.prior.week.visitsN, 2);
  assert.deepEqual(plain(snap.prior.week.sites), ['priorsite.com']);

  // Per-company mech rollup across both today visits for Google.
  assert.deepEqual(plain(snap.today.watchers.google.mech), { cookies: 5, pixels: 3, clicks: 0, deviceId: 1 });
});

test('aggregateWindow counts a watcher once per visit even if duplicated', () => {
  const ctx = loadServiceWorkerModule('snapshots.js');
  const now = Date.now();
  const history = [
    visit({ at: now, etld1: 'x.com', watchers: ['Google', 'google', 'GOOGLE'] }),
  ];
  const snap = ctx.snapshotsCompute(history);
  assert.equal(snap.today.watchers.google.hits, 1);
  assert.equal(snap.today.contacts, 1);
});

test('getWindowAggregates returns cur+prev for named windows, prev=null for "all"', async () => {
  const chrome = makeChromeStub();
  const ctx = loadServiceWorkerModule('snapshots.js', { chromeStub: chrome });
  const now = Date.now();
  await chrome.storage.local.set({
    visitHistory: [
      visit({ at: now, etld1: 'cur.com' }),
      visit({ at: now - 8 * DAY, etld1: 'prev.com' }),
    ],
  });

  const wk = await ctx.snapshotsGetWindow('week');
  assert.equal(wk.cur.sites[0], 'cur.com');
  assert.equal(wk.prev.sites[0], 'prev.com');

  const all = await ctx.snapshotsGetWindow('all');
  assert.equal(all.cur.sites.length, 2);
  assert.equal(all.prev, null);
});

test('recomputeIfStale: serves cached snapshot inside the staleness window', async () => {
  const chrome = makeChromeStub();
  const ctx = loadServiceWorkerModule('snapshots.js', { chromeStub: chrome });

  // First call populates a fresh snapshot.
  await chrome.storage.local.set({ visitHistory: [visit({ etld1: 'a.com' })] });
  const first = await ctx.snapshotsRecomputeIfStale();
  const firstStamp = first.computedAt;

  // Modify history; second call should NOT recompute (within 5min).
  await chrome.storage.local.set({ visitHistory: [visit({ etld1: 'b.com' })] });
  const second = await ctx.snapshotsRecomputeIfStale();
  assert.equal(second.computedAt, firstStamp, 'served from cache');
  assert.equal(second.today.sites[0], 'a.com',  'cached aggregate');
});
