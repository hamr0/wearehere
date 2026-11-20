// scoper.js — which cookies the scoper must never rewrite (partitioned, or
// on a captcha/challenge host; path-scoped challenge patterns also need the
// cookie's path under the pattern path).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorkerModule, makeChromeStub } from './_helpers.js';

const EXCLUDES = [
  '*://challenges.cloudflare.com/*',
  '*://*.hcaptcha.com/*',
  '*://www.google.com/recaptcha/*',
  '*://recaptcha.google.com/recaptcha/*',
];

function load() {
  const stub = makeChromeStub();
  stub.cookies.onChanged = { addListener: () => {} };
  stub.storage.onChanged = { addListener: () => {} };
  stub.runtime.onInstalled = { addListener: () => {} };
  stub.runtime.onStartup = { addListener: () => {} };
  const ctx = loadServiceWorkerModule('scoper/scoper.js', {
    chromeStub: stub,
    extras: { WH_CHALLENGE_EXCLUDES: EXCLUDES },
  });
  return ctx.scoperShouldSkipCookie;
}

const ck = (domain, path, extra = {}) => ({ domain, path, name: 'x', ...extra });

test('www.google.com cookie under /recaptcha is exempt', () => {
  const skip = load();
  assert.equal(skip(ck('www.google.com', '/recaptcha')), true);
  assert.equal(skip(ck('www.google.com', '/recaptcha/api2')), true);
});

test('www.google.com cookie at path / is not exempt', () => {
  const skip = load();
  assert.equal(skip(ck('www.google.com', '/')), false);
  assert.equal(skip(ck('www.google.com', '/recaptchaX')), false);
  assert.equal(skip(ck('.google.com', '/recaptcha')), false);
});

test('host-only challenge pattern exempts any path', () => {
  const skip = load();
  assert.equal(skip(ck('challenges.cloudflare.com', '/')), true);
  assert.equal(skip(ck('.challenges.cloudflare.com', '/cdn-cgi')), true);
  assert.equal(skip(ck('newassets.hcaptcha.com', '/')), true);
});

test('partitioned cookie (typesafe cf_clearance) is still skipped', () => {
  const skip = load();
  assert.equal(skip(ck('.typesafe.ai', '/', { partitionKey: { topLevelSite: 'https://typesafe.ai' } })), true);
  assert.equal(skip(ck('.typesafe.ai', '/', { firstPartyDomain: 'typesafe.ai' })), true);
  assert.equal(skip(ck('.typesafe.ai', '/')), false);
});
