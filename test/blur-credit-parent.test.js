// recordBlurredByCompany (real background.js source, extracted): a parent is
// credited once per visit as the max of its own and its sub-brands' counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { SRC_DIR, makeChromeStub, plain } from './_helpers.js';
import { resolve } from 'node:path';

async function credit(perCompanyIn) {
  const src = readFileSync(resolve(SRC_DIR, 'background.js'), 'utf8');
  const a = src.indexOf('const MAX_BLURRED_COMPANIES');
  const b = src.indexOf('self.recordBlurredByCompany = recordBlurredByCompany;');
  assert.ok(a > 0 && b > a);
  const chrome = makeChromeStub();
  const ctx = { chrome, Object, Math, Promise };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(resolve(SRC_DIR, 'company-map.js'), 'utf8'), ctx);
  vm.runInContext(src.slice(a, b + 'self.recordBlurredByCompany = recordBlurredByCompany;'.length), ctx);
  await ctx.recordBlurredByCompany(perCompanyIn);
  const m = plain((await chrome.storage.local.get('farblerBlurredByCompany')).farblerBlurredByCompany);
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.count]));
}

test('Ads 5 + Analytics 5 on the same APIs -> Google 5', async () => {
  const r = await credit({ 'Google Ads': 5, 'Google Analytics': 5 });
  assert.equal(r['google'], 5);
  assert.equal(r['google ads'], 5);
  assert.equal(r['google analytics'], 5);
});

test('Ads 3 + Analytics 2 -> Google 3', async () => {
  const r = await credit({ 'Google Ads': 3, 'Google Analytics': 2 });
  assert.equal(r['google'], 3);
});

test('parent own count kept when larger than sub-brands', async () => {
  const r = await credit({ Google: 6, 'Google Ads': 3 });
  assert.equal(r['google'], 6);
});

test('single sub-brand credits its parent', async () => {
  const r = await credit({ 'Google Ads': 3 });
  assert.equal(r['google'], 3);
});
