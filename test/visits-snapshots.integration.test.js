// Integration: feed reports into visits.js → read them via snapshots.js.
// Pins the data contract between the two modules: the visit record
// shape compactVisit writes is the shape aggregateWindow consumes.
// If either side drifts, this fails loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorkerModule, makeChromeStub, plain } from './_helpers.js';

function reportFor(site, score, opts = {}) {
  return {
    site,
    url: `https://${site}/`,
    verdict: { score },
    cookies: { snoops: opts.snoops || 0, thirdParty: opts.cookieCount || 0 },
    trackers: {
      pixels: opts.pixels || 0, beacons: 0, hiddenIframes: 0,
      companies: opts.companies || [],
    },
    fingerprinting: { techniques: opts.fp || 0 },
    forms: { fieldCount: opts.typing || 0 },
    linkTracking: { tracked: opts.clicks || 0 },
    network: { brokerCount: (opts.brokers || []).length, brokers: (opts.brokers || []).map((n) => ({ name: n })) },
    tos: { found: opts.tos != null, score: opts.tos },
    localData: { suspicious: 0 },
  };
}

test('visits → snapshots: aggregates reflect the persisted history', async () => {
  // Shared chrome stub so both modules read the same in-memory store.
  const chrome = makeChromeStub();
  const visits   = loadServiceWorkerModule('visits.js',    { chromeStub: chrome });
  const snaps    = loadServiceWorkerModule('snapshots.js', { chromeStub: chrome });

  // Append three visits — two to cnn.com, one to nyt.com — all in the
  // last day, so they should all roll up into 'today'.
  await visits.visitsAppend(reportFor('cnn.com', 60, {
    snoops: 10, pixels: 4, fp: 1, clicks: 0,
    cookieCount: 30,
    companies: [{ name: 'Google', viaCookies: 5, viaPixels: 2 }, { name: 'Meta', viaPixels: 3 }],
    brokers: ['Acxiom'],
    tos: 18,
  }));
  await visits.visitsAppend(reportFor('cnn.com', 50, {
    snoops: 8, pixels: 3, fp: 1,
    cookieCount: 22,
    companies: [{ name: 'Google', viaCookies: 3, viaPixels: 1 }],
    brokers: ['Acxiom'],
  }));
  await visits.visitsAppend(reportFor('nyt.com', 30, {
    snoops: 4, pixels: 1, typing: 2,
    cookieCount: 9,
    companies: [{ name: 'Adobe', viaPixels: 1 }],
    tos: 42,
  }));

  // First snapshot read populates the cache.
  const today = (await snaps.snapshotsGetWindow('today')).cur;

  assert.equal(today.visitsN, 3);
  assert.deepEqual(plain(today.sites.sort()), ['cnn.com', 'nyt.com']);
  assert.equal(today.avgScore, Math.round((60 + 50 + 30) / 3));

  // Reach: Google on 2/3 visits, Meta + Adobe + Acxiom on 1/3.
  assert.equal(today.reachPct.google, 67);
  assert.equal(today.reachPct.meta,   33);
  assert.equal(today.reachPct.adobe,  33);

  // Mech rollup for Google across the two cnn.com visits.
  assert.deepEqual(plain(today.watchers.google.mech), { cookies: 8, pixels: 3, clicks: 0, deviceId: 0 });

  // latestBySite: cnn.com's *newest* append had cookieCount=22 (score 50
  // was the second visit, which lands at the front of the ring buffer
  // and so is the "latest"). nyt.com only has one visit, cookieCount=9.
  assert.equal(today.latestBySite['cnn.com'].cookieCount, 22);
  assert.equal(today.latestBySite['nyt.com'].cookieCount, 9);

  // typing: only nyt.com fired, 2 fields, 1 visit.
  assert.equal(today.typing.fields, 2);
  assert.equal(today.typing.visits, 1);

  // Broker rollup.
  assert.equal(today.brokers.acxiom.hits, 2);
});
