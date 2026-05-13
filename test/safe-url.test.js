// isSafeBgFetchUrl — best-effort SSRF guard for the bgFetch handler in
// background.js. Lives as a module-scope function in background.js;
// we extract it via a regex from the source and eval into a fresh
// context so we don't have to load the whole 1200-line SW.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const bg = readFileSync(
  resolve(__dirname, '..', 'chrome-extension', 'background.js'),
  'utf8',
);

// Grab the helper plus its supporting regex constants. The block
// is contiguous in source — pin to its leading comment.
const block = bg.match(
  /\/\/ Best-effort SSRF guard[\s\S]*?function isSafeBgFetchUrl\(url\) \{[\s\S]*?\n\}/,
);
if (!block) throw new Error('isSafeBgFetchUrl source not found — refactor?');

const ctx = { URL, console: { log() {}, warn() {}, error() {} } };
vm.createContext(ctx);
vm.runInContext(block[0] + '\nthis.isSafeBgFetchUrl = isSafeBgFetchUrl;', ctx);
const { isSafeBgFetchUrl } = ctx;

test('accepts plausible policy/terms URLs', () => {
  for (const url of [
    'https://example.com/privacy',
    'http://example.com/terms',
    'https://policies.google.com/privacy?hl=en',
    'https://www.nytimes.com/privacy-policy',
    'https://shopify.com/legal/tos',
  ]) {
    assert.equal(isSafeBgFetchUrl(url), true, url);
  }
});

test('rejects non-http(s) schemes', () => {
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,<x>',
    'chrome-extension://abc/file.html',
    'ftp://example.com/',
  ]) {
    assert.equal(isSafeBgFetchUrl(url), false, url);
  }
});

test('rejects local + private hostnames', () => {
  for (const url of [
    'http://localhost/secret',
    'https://service.local/',
    'http://admin.internal/',
    'http://api.localhost/',
  ]) {
    assert.equal(isSafeBgFetchUrl(url), false, url);
  }
});

test('rejects RFC1918 + loopback + link-local + multicast IPv4', () => {
  for (const url of [
    'http://10.0.0.1/',
    'http://10.255.255.255/',
    'http://172.16.0.1/',
    'http://172.31.255.1/',
    'http://192.168.1.1/',
    'http://127.0.0.1/',
    'http://169.254.169.254/',         // AWS/GCP metadata endpoint
    'http://0.0.0.0/',
    'http://224.0.0.1/',                // multicast
    'http://239.255.255.250/',          // SSDP
    'http://100.64.0.1/',               // CGNAT
    'http://100.127.0.1/',
  ]) {
    assert.equal(isSafeBgFetchUrl(url), false, url);
  }
});

test('accepts public-internet IPv4 (the edge of the deny set)', () => {
  // Sanity: 8.8.8.8 (Google DNS) and similar must NOT be rejected by
  // the private-IP filter. If these get flagged the rule is too eager.
  for (const url of [
    'http://8.8.8.8/',
    'http://1.1.1.1/',
    'http://173.16.0.1/',  // outside 172.16/12
    'http://192.169.1.1/', // outside 192.168/16
    'http://100.63.0.1/',  // outside CGNAT
  ]) {
    assert.equal(isSafeBgFetchUrl(url), true, url);
  }
});

test('rejects all IPv6 literals', () => {
  for (const url of [
    'http://[::1]/',
    'https://[2001:db8::1]/',
    'http://[fe80::1]/',
  ]) {
    assert.equal(isSafeBgFetchUrl(url), false, url);
  }
});

test('rejects malformed input + oversized URLs', () => {
  assert.equal(isSafeBgFetchUrl(null), false);
  assert.equal(isSafeBgFetchUrl(undefined), false);
  assert.equal(isSafeBgFetchUrl(''), false);
  assert.equal(isSafeBgFetchUrl('not a url'), false);
  assert.equal(isSafeBgFetchUrl('https://' + 'x'.repeat(3000) + '.com'), false);
});
