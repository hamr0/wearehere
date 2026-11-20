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
