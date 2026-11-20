// company-map.js — sub-brand parents, registrable-domain seeding, and the
// merge-by-parent + "everything else" logic behind the Watchers table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorkerModule, plain } from './_helpers.js';

const ctx = loadServiceWorkerModule('company-map.js');
const lastTwo = (h) => h.split('.').slice(-2).join('.');

test('companyParent: prefix and parenthesised owners resolve to known parents', () => {
  assert.equal(ctx.WH_companyParent('Google Ads'), 'Google');
  assert.equal(ctx.WH_companyParent('Google Analytics'), 'Google');
  assert.equal(ctx.WH_companyParent('YouTube (Google)'), 'Google');
  assert.equal(ctx.WH_companyParent('Taobao (Alibaba)'), 'Alibaba');
  assert.equal(ctx.WH_companyParent('Meta Pixel'), 'Meta');
});

test('companyParent: top-level names and unknown owners have no parent', () => {
  assert.equal(ctx.WH_companyParent('Google'), null);
  assert.equal(ctx.WH_companyParent('X'), null);
  assert.equal(ctx.WH_companyParent('Meta'), null);
  assert.equal(ctx.WH_companyParent('Acme Widgets'), null);
  assert.equal(ctx.WH_companyParent(''), null);
});

test('seedDomainCompany: keyed by registrable domain via supplied helper', () => {
  const seed = ctx.WH_seedDomainCompany(lastTwo);
  assert.equal(seed['doubleclick.net'], 'Google Ads');
  assert.equal(seed['google.com'], 'Google');
  assert.equal(seed['baidu.com'], 'Baidu'); // exact key beats hm.baidu.com subdomain entry
  assert.equal(seed['googlesyndication.com'], 'Google Ads');
});

test('companyParent: aliases the name rules miss', () => {
  assert.equal(ctx.WH_companyParent('Facebook'), 'Meta');
  assert.equal(ctx.WH_companyParent('Facebook Pixel'), 'Meta');
  assert.equal(ctx.WH_companyParent('X (Twitter)'), 'X');
  assert.equal(ctx.WH_companyParent('Oracle (BlueKai)'), 'Oracle');
  assert.equal(ctx.WH_companyParent('Moat (Oracle)'), 'Oracle');
  assert.equal(ctx.WH_companyParent('Pardot'), 'Salesforce');
  assert.equal(ctx.WH_companyParent('Microsoft Clarity'), 'Microsoft');
  assert.equal(ctx.WH_companyParent('TikTok'), 'ByteDance');
  assert.equal(ctx.WH_companyParent('LinkedIn'), 'Microsoft');
  assert.equal(ctx.WH_companyParent('Marketo'), 'Adobe');
  assert.equal(ctx.WH_companyParent('Zemanta'), 'Outbrain');
  assert.equal(ctx.WH_companyParent('Alipay'), 'Alibaba');
  assert.equal(ctx.WH_companyParent('Snapchat'), 'Snap');
  assert.deepEqual(plain(ctx.WH_watcherGroup('YouTube (Google)')), { key: 'google', name: 'Google' });
  assert.deepEqual(plain(ctx.WH_watcherGroup('Hotjar')), { key: 'hotjar', name: 'Hotjar' });
});

const M = (o = {}) => Object.assign({ cookies: 0, pixels: 0, clicks: 0, deviceId: 0 }, o);

test('buildWatcherRows: merges by parent, drops zero rows to quiet list, else adds up', () => {
  const snap = { groups: {
    google: { name: 'Google', hits: 4, mech: M({ cookies: 3, pixels: 1 }) },
    meta: { name: 'Meta', hits: 1, mech: M() },
    optimizely: { name: 'Optimizely', hits: 2, mech: M() },
    'index exchange': { name: 'Index Exchange', hits: 1, mech: M() },
  } };
  // google counter already includes its sub-brands; stale standalone child
  // counters ('google ads') must not be added again.
  const trimmed = { google: { tightened: 456 }, 'google ads': { tightened: 100 }, meta: { tightened: 0 } };
  const blurred = { google: { count: 41 }, meta: { count: 2 } };
  const t = ctx.WH_buildWatcherRows(snap, trimmed, blurred, 600, 300, 12);
  assert.deepEqual(plain(t.rows.map((r) => [r.name, r.hits, r.trimmed, r.blurred])),
    [['Google', 4, 456, 41], ['Meta', 1, 0, 2]]);
  assert.deepEqual(plain(t.quiet), ['Index Exchange', 'Optimizely']);
  assert.equal(t.elseTrimmed, 600 - 456);
  assert.equal(t.elseBlurred, 300 - 43);
  assert.equal(456 + t.elseTrimmed, 600);
});

test('buildWatcherRows: else clamps at 0; no quiet line data when none quiet', () => {
  const snap = { groups: { google: { name: 'Google', hits: 2, mech: M() } } };
  const t = ctx.WH_buildWatcherRows(snap, { google: { tightened: 9 } }, { google: { count: 1 } }, 5, 0, 12);
  assert.equal(t.elseTrimmed, 0);
  assert.equal(t.elseBlurred, 0);
  assert.equal(t.quiet.length, 0);
});

test('buildWatcherRows: legacy snapshot without groups rolls watchers up by parent', () => {
  const snap = { watchers: {
    'google ads': { name: 'Google Ads', hits: 3, mech: M({ pixels: 2 }) },
    'youtube (google)': { name: 'YouTube (Google)', hits: 5, mech: M({ clicks: 1 }) },
    facebook: { name: 'Facebook', hits: 1, mech: M() },
  } };
  const t = ctx.WH_buildWatcherRows(snap, { google: { tightened: 7 }, meta: { tightened: 1 } }, {}, 8, 0, 12);
  assert.deepEqual(plain(t.rows.map((r) => [r.name, r.hits, r.trimmed])), [['Google', 5, 7], ['Meta', 1, 1]]);
});

test('uniqueParents: dedupes by parent, keeps first-appearance order', () => {
  const r = plain(ctx.WH_uniqueParents(['Google Ads', 'Meta Pixel', 'Google', 'a.et.nytimes.com', 'Facebook']));
  assert.deepEqual(r.map((g) => g.name), ['Google', 'Meta', 'a.et.nytimes.com']);
});

test('parentTotals: counts parents and contacts from groups, falls back to watchers', () => {
  const g = { groups: { google: { name: 'Google', hits: 3 }, meta: { name: 'Meta', hits: 2 } }, contacts: 99 };
  assert.deepEqual(plain(ctx.WH_parentTotals(g)), { unique: 2, contacts: 5 });
  const old = { contacts: 7, watchers: { 'google ads': { name: 'Google Ads' }, google: { name: 'Google' }, x: { name: 'Foo' } } };
  assert.deepEqual(plain(ctx.WH_parentTotals(old)), { unique: 2, contacts: 7 });
});

test('mergeCompanies: sub-brands fold under parent, counters sum, purposes dedupe', () => {
  const r = plain(ctx.WH_mergeCompanies([
    { name: 'Google Ads', purpose: 'Advertising', count: 2, viaPixels: 2, viaCookies: 0 },
    { name: 'a.et.nytimes.com', purpose: 'Unknown', count: 1, viaPixels: 1, viaCookies: 0 },
    { name: 'Google', purpose: 'Analytics', count: 1, viaPixels: 0, viaCookies: 1 },
    { name: 'Google Tag Manager', purpose: 'Advertising', count: 1, viaPixels: 1, viaCookies: 0 },
  ]));
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: 'Google', purpose: 'Advertising, Analytics', count: 4, viaPixels: 3, viaCookies: 1 });
  assert.equal(r[1].name, 'a.et.nytimes.com');
  assert.equal(r[1].purpose, 'Unknown');
});

test('groupStoredKeys: strips trailing id segments, merges flags, keeps others', () => {
  const r = plain(ctx.WH_groupStoredKeys([
    { key: 'statsig.stable_id.2734485462', flags: ['PII exposure'] },
    { key: 'statsig.stable_id.348932488', flags: ['Tracking'] },
    { key: 'statsig.session_id.a1b2c3d4e5f6', flags: ['Tracking'] },
    { key: 'statsig.session_id.0f8fad5b-d9cb-469f-a165-70867728950e', flags: [] },
    { key: 'user_id', flags: ['PII exposure'] },
    { key: '12345', flags: [] },
  ]));
  assert.deepEqual(r, [
    { key: 'statsig.stable_id', n: 2, flags: ['PII exposure', 'Tracking'] },
    { key: 'statsig.session_id', n: 2, flags: ['Tracking'] },
    { key: 'user_id', n: 1, flags: ['PII exposure'] },
    { key: '12345', n: 1, flags: [] },
  ]);
});

test('pickTrimTab: first-party tab wins, else tab that contacted the host, else null', () => {
  const tabs = {
    1: { domain: 'www.cnn.com', networkData: { thirdPartyDomains: { 'securepubads.g.doubleclick.net': {} } } },
    2: { domain: 'bbc.co.uk', networkData: { thirdPartyDomains: {} } },
    3: { domain: '', networkData: null },
  };
  const e1 = (h) => (h.endsWith('bbc.co.uk') ? 'bbc.co.uk' : h.split('.').slice(-2).join('.'));
  assert.equal(ctx.WH_pickTrimTab(tabs, '.cnn.com', 'cnn.com', e1), tabs[1]);
  assert.equal(ctx.WH_pickTrimTab(tabs, 'www.bbc.co.uk', 'bbc.co.uk', e1), tabs[2]);
  assert.equal(ctx.WH_pickTrimTab(tabs, '.doubleclick.net', 'doubleclick.net', e1), tabs[1]);
  assert.equal(ctx.WH_pickTrimTab(tabs, '.ick.net', 'ick.net', e1), null); // suffix must be a label boundary
  assert.equal(ctx.WH_pickTrimTab(tabs, '.unseen.org', 'unseen.org', e1), null);
  assert.equal(ctx.WH_pickTrimTab(tabs, '', '', e1), null);
});

test('fmtCount: compact, truncating, never overstates', () => {
  const f = ctx.WH_fmtCount;
  const cases = [[0, '0'], [999, '999'], [1000, '1k'], [1049, '1k'], [1099, '1k'], [1100, '1.1k'],
    [9960, '9.9k'], [9999, '9.9k'], [10000, '10k'], [250000, '250k'], [999999, '999k'],
    [1000000, '1M'], [1250000, '1.2M']];
  for (const [n, out] of cases) assert.equal(f(n), out, String(n));
  assert.equal(f(undefined), '0');
});
