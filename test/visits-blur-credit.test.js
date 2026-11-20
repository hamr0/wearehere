// Per-company blur credit must follow the same gate as blurredSurfaces:
// no credit when blur mode for the site is "off".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorkerModule, makeChromeStub, plain } from './_helpers.js';

const report = (site) => ({
  site, url: `https://${site}/`, verdict: { score: 50 },
  cookies: { snoops: 0, thirdParty: 0 },
  trackers: { pixels: 0, beacons: 0, hiddenIframes: 0,
    companies: [{ name: 'Google Analytics', viaDeviceId: 5 }, { name: 'Meta', viaDeviceId: 3 }] },
  fingerprinting: { techniques: 1, methods: [{ technique: 'fingerprint', apis: ['a', 'b', 'c', 'd', 'e'] }] },
  forms: { fieldCount: 0 }, linkTracking: { tracked: 0 },
  network: { brokerCount: 0, brokers: [] }, tos: { found: false }, localData: { suspicious: 0 },
});

async function run(initial, site = 'example.com') {
  const chrome = makeChromeStub(initial);
  const credits = [];
  const v = loadServiceWorkerModule('visits.js', { chromeStub: chrome });
  v.recordBlurredByCompany = async (m) => { credits.push(plain(m)); };
  await v.visitsAppend(report(site));
  const hist = plain((await chrome.storage.local.get('visitHistory')).visitHistory);
  return { credits, rec: hist[0] };
}

test('blur off for the site: no company credit, blurredSurfaces 0', async () => {
  const { credits, rec } = await run({ farblerSettings: { 'example.com': { mode: 'off' } } });
  assert.deepEqual(credits, []);
  assert.equal(rec.blurredSurfaces, 0);
});

test('blur default off: no company credit', async () => {
  const { credits } = await run({ defaultBlurMode: 'off' });
  assert.deepEqual(credits, []);
});

test('per-site override on beats default off: companies credited', async () => {
  const { credits, rec } = await run({ defaultBlurMode: 'off', farblerSettings: { 'example.com': { mode: 'stable' } } });
  assert.deepEqual(credits, [{ 'Google Analytics': 5, Meta: 3 }]);
  assert.equal(rec.blurredSurfaces, 5);
});

test('default mode: companies credited', async () => {
  const { credits } = await run({});
  assert.deepEqual(credits, [{ 'Google Analytics': 5, Meta: 3 }]);
});
