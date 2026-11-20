// visits.js — navLeavesVisit: the single decision "did this navigation end
// the visit we hold?". Called from both webRequest (main_frame) and
// tabs.onUpdated; background.js relies on it being idempotent so one
// departure snapshots exactly once whichever event arrives first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadServiceWorkerModule } from './_helpers.js';

const { navLeavesVisit } = loadServiceWorkerModule('visits.js');

test('cross-site navigation leaves the visit', () => {
  assert.equal(navLeavesVisit('cnn.com', 'example.org'), true);
});

test('subdomain change counts as leaving (domain = hostname)', () => {
  assert.equal(navLeavesVisit('cnn.com', 'edition.cnn.com'), true);
});

test('same host does not leave: reload, same-site nav, redirect hop', () => {
  assert.equal(navLeavesVisit('cnn.com', 'cnn.com'), false);
});

test('tab close (no new host) always leaves', () => {
  assert.equal(navLeavesVisit('cnn.com', undefined), true);
});

test('unparseable target URL (empty host) leaves', () => {
  assert.equal(navLeavesVisit('cnn.com', ''), true);
});

test('no held domain: nothing to compare, treated as leaving', () => {
  assert.equal(navLeavesVisit('', 'example.org'), true);
  assert.equal(navLeavesVisit(undefined, 'example.org'), true);
});

test('one departure is claimed once whichever event arrives first', () => {
  // Model what background.js does: the held visit is evicted and the tab
  // re-labelled with the new host by whichever call site runs first.
  for (const order of [['wr', 'upd'], ['upd', 'wr']]) {
    let held = 'cnn.com';
    let snapshots = 0;
    for (const _ev of order) {
      if (held && navLeavesVisit(held, 'example.org')) snapshots++;
      held = 'example.org';
    }
    assert.equal(snapshots, 1, order.join('->'));
  }
});
