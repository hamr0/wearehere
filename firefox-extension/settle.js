"use strict";

// Shared "when settled" scheduler for the report-only content scripts.
//
// Anything that only feeds the dashboard/popup numbers (dark patterns, trackers,
// tracking links, policy links, storage leaks, form fields) runs through here, so
// it never competes with the page while it loads or moves. Protection code
// (inject.js, detect-watched.js, the background scoper) does NOT use this.
//
// A job is a generator function. It does a little work, `yield`s, and the
// scheduler decides whether to resume it in this idle slice or later.
//
//   whSettle.schedule(function* () { ...; yield; ... })   run at next settle
//   whSettle.later(fn) -> Promise                          one-shot fn at next settle
//   whSettle.feed(wake) -> feed                            queue added DOM nodes (cheap)
//   feed.take() -> batch                                   snapshot-and-clear the queue
//   whSettle.matches(batch, sel, seen, detached)           elements to visit (deduped)
//   whSettle.stop()                                        give up (context invalidated)
//
// First count = window load done, tab visible, and QUIET_MS with no scroll / wheel /
// touch / key / pointer activity and no burst of DOM additions. Work then runs in
// requestIdleCallback slices of at most SLICE_MS. Activity mid-run pauses after
// the current slice and the quiet timer restarts. After MAX_WAIT_MS of unbroken
// activity it runs anyway (still sliced) so busy pages get counted.
// After the first count nothing more runs while the user is on the page: later
// content is only queued (cheap, deduped). The queue is processed when the tab is
// hidden (full sliced run), when the popup/dashboard asks (flush), and as a tiny
// bounded pass on pagehide. Jobs marked noLeave (policy fetches, SPA URL change)
// are event-driven and still run when scheduled.
// The script shares one isolated world with the others, so the guard below makes
// loading it from several manifest entries harmless.

var whSettle = (typeof whSettle !== "undefined") ? whSettle : (function () {
  var QUIET_MS = 2000;      // first count: 2 s of quiet after load
  var MAX_WAIT_MS = 5000;
  var SLICE_MS = 12;
  var HIDDEN_SLICE_MS = 50;   // page is not moving: bigger slices, timers are throttled anyway
  var LEAVE_BUDGET_MS = 12;   // quick pass when the user leaves: hard cap (plus one step)
  var QUEUE_CAP = 3000;
  var SIGNIFICANT_ADDS = 20;  // fewer added elements than this per burst is not "churn"
  var SPLIT_DEPTH = 3;        // full scans are split into subtrees down to this depth
  var SPLIT_MAX = 150;

  var jobs = [];
  var byFn = new Map();
  var feeds = [];
  var lastActivity = performance.now();
  var waitStart = null;
  var timer = null;
  var idle = null;
  var forced = false;
  var firstDone = false;      // first count finished: from now on only hidden / flush / leave run work
  var stopped = false;
  var inited = false;
  var observer = null;
  var flushing = false;       // popup/dashboard asked for the numbers now
  var leaveHandlers = [];
  var drainWaiters = [];
  var leftAt = -1e9;

  function now() { return performance.now(); }
  function noteActivity() { lastActivity = now(); }

  // ── Mutation observer: queue added nodes for feeds, flag bursts as churn ──

  function onMutations(records) {
    var adds = 0;
    for (var i = 0; i < records.length; i++) {
      if (records[i].type === "characterData") {
        // Text rewritten in place (hydration, price updates): revisit its element.
        touchText(records[i].target.parentElement);
        continue;
      }
      var added = records[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        var el = null;
        if (n.nodeType === 1) { el = n; adds++; }
        else if (n.nodeType === 3) { touchText(n.parentElement); continue; }
        if (!el) continue;
        for (var k = 0; k < feeds.length; k++) queueNode(feeds[k], el, false);
        touchText(el.parentElement, 2);   // an added child changes its parent's text too
      }
    }
    if (adds >= SIGNIFICANT_ADDS) noteActivity();
  }

  // Text changed under `el`: its own text and that of a few small ancestors
  // (a ticker "NASDAQ -1.5%" is one element whose text a child just filled in).
  function touchText(el, levels) {
    for (var depth = 0; el && depth < (levels || 4); el = el.parentElement, depth++) {
      if (el.childElementCount > 50) break;   // a big container is not a text carrier
      for (var k = 0; k < feeds.length; k++) queueNode(feeds[k], el, true);
    }
  }

  function queueNode(f, el, fromText) {
    if (f.full) return;
    if (fromText) f.retouch.add(el);
    if (f.nodes.length >= QUEUE_CAP) { f.full = true; f.nodes = []; wakeFeed(f); return; }
    if (f.queued.has(el)) return;
    f.queued.add(el);
    f.nodes.push(el);
    wakeFeed(f);
  }

  function wakeFeed(f) {
    if (f.pending) return;
    f.pending = true;
    if (f.wake) f.wake();
  }

  // ── Setup (lazy, once) ──

  function init() {
    if (inited) return;
    inited = true;
    var opts = { passive: true, capture: true };
    ["scroll", "wheel", "touchstart", "touchmove", "keydown", "pointerdown", "pointermove"].forEach(function (ev) {
      window.addEventListener(ev, noteActivity, opts);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        // User switched away: report what is counted plus a tiny pass, then finish
        // the rest in the background tab (page is not moving there).
        cancelTimers();
        leavePass();
        arm();
        return;
      }
      noteActivity();
      arm();
    });
    window.addEventListener("pagehide", function () { leavePass(); stopped = true; cancelTimers(); });
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (!msg || msg.type !== "wh-flush") return;
        flush().then(function () { sendResponse({ ok: true }); });
        return true;
      });
    } catch (e) {}
    window.addEventListener("pageshow", function (e) {
      if (!e.persisted) return;
      stopped = false;
      noteActivity();
      arm();
    });
    if (document.readyState !== "complete") {
      window.addEventListener("load", function () { noteActivity(); arm(); }, { once: true });
    }
    if (document.documentElement) {
      observer = new MutationObserver(onMutations);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    }
  }

  function cancelTimers() {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    if (idle !== null) {
      if (idle.ric && window.cancelIdleCallback) cancelIdleCallback(idle.id);
      else clearTimeout(idle.id);
      idle = null;
    }
    waitStart = null;
  }

  // ── Scheduling ──

  function arm() {
    if (stopped || timer !== null || idle !== null || !pickJob()) return;
    if (urgent()) { timer = setTimeout(onTimer, 0); return; }
    if (document.readyState !== "complete") return;
    var t = now();
    if (waitStart === null) waitStart = t;
    var wait;
    if (forced || t - waitStart >= MAX_WAIT_MS) { forced = true; wait = 0; }
    else wait = Math.min(Math.max(0, QUIET_MS - (t - lastActivity)), MAX_WAIT_MS - (t - waitStart));
    timer = setTimeout(onTimer, wait);
  }

  function onTimer() {
    timer = null;
    if (stopped) return;
    var t = now();
    if (waitStart !== null && t - waitStart >= MAX_WAIT_MS) forced = true;
    if (!urgent() && !forced && t - lastActivity < QUIET_MS) { arm(); return; }
    requestSlice();
  }

  // Hidden tab or an explicit flush: no quiet period, no per-round cap.
  function urgent() { return document.hidden || flushing; }

  // After the first count, only noLeave (event-driven) jobs run on a visible page.
  function pickJob() {
    if (!firstDone || urgent()) return jobs[0];
    for (var i = 0; i < jobs.length; i++) if (jobs[i].noLeave) return jobs[i];
    return undefined;
  }

  function requestSlice() {
    if (urgent()) idle = { ric: false, id: setTimeout(pump, 0) };   // rIC is throttled in background tabs
    else if (window.requestIdleCallback) idle = { ric: true, id: requestIdleCallback(pump, { timeout: 2000 }) };
    else idle = { ric: false, id: setTimeout(pump, 50) };
  }

  function pump(deadline) {
    idle = null;
    if (stopped) return;
    var urg = urgent();
    if (!urg && !forced && now() - lastActivity < QUIET_MS) { arm(); return; }   // activity resumed: wait again
    var t0 = now();
    var sliceMs = document.hidden ? HIDDEN_SLICE_MS : SLICE_MS;
    var j;
    while ((j = pickJob())) {
      stepJob(j);
      var spent = now() - t0;
      if (spent >= sliceMs) break;
      if (deadline && !deadline.didTimeout && deadline.timeRemaining() < 1.5) break;
    }
    if (!jobs.length) { firstDone = true; forced = false; flushing = false; waitStart = null; resolveDrain(); return; }
    if (!pickJob()) { forced = false; waitStart = null; resolveDrain(); return; }   // only gated jobs left
    if (timer === null && idle === null) requestSlice();
  }

  // One step of a job; removes it when done. Returns true when finished.
  function stepJob(j) {
    var r;
    try {
      if (!j.gen) {
        j.gen = j.fn();
        if (!j.gen || typeof j.gen.next !== "function") j.gen = null;   // plain function already ran
      }
      r = j.gen ? j.gen.next() : { done: true };
    } catch (e) {
      console.warn("[wearehere] settled job error:", e && e.message);
      r = { done: true };
    }
    if (r.done) {
      var at = jobs.indexOf(j);
      if (at >= 0) jobs.splice(at, 1);
      byFn.delete(j.fn);
      if (j.again) schedule(j.fn);
      return true;
    }
    return false;
  }

  function resolveDrain() {
    var w = drainWaiters; drainWaiters = [];
    for (var i = 0; i < w.length; i++) w[i]();
  }

  // Run everything pending now (popup/dashboard opened). Resolves when drained.
  function flush() {
    return new Promise(function (resolve) {
      if (stopped || !jobs.length) { resolve(); return; }
      drainWaiters.push(resolve);
      flushing = true;
      cancelTimers();
      arm();
    });
  }

  // Scripts register a function that sends whatever they have counted so far.
  function onLeave(fn) { leaveHandlers.push(fn); }

  // User is leaving or switching away. No time for a real scan: round-robin the
  // pending jobs (document order, so the top of the page first) for at most
  // LEAVE_BUDGET_MS plus one step, then let each script send what it has.
  // Jobs marked noLeave (policy fetches) are skipped.
  function leavePass() {
    if (stopped || !inited) return;
    var t0 = now();
    if (t0 - leftAt < 50) return;   // hidden then pagehide back to back
    leftAt = t0;
    var live = jobs.filter(function (j) { return !j.noLeave; });
    var progressed = true;
    while (live.length && progressed && now() - t0 < LEAVE_BUDGET_MS) {
      progressed = false;
      for (var i = 0; i < live.length && now() - t0 < LEAVE_BUDGET_MS; i++) {
        progressed = true;
        if (stepJob(live[i])) { live.splice(i, 1); i--; }
      }
    }
    for (var h = 0; h < leaveHandlers.length; h++) {
      try { leaveHandlers[h](); } catch (e) {}
    }
  }

  function schedule(fn, opts) {
    if (stopped) return;
    init();
    var j = byFn.get(fn);
    if (j) { if (j.gen) j.again = true; }
    else { j = { fn: fn, gen: null, again: false, noLeave: !!(opts && opts.noLeave) }; byFn.set(fn, j); jobs.push(j); }
    arm();
  }

  function later(fn) {
    return new Promise(function (resolve, reject) {
      schedule(function () {
        try { resolve(fn()); } catch (e) { reject(e); }
      }, { noLeave: true });
    });
  }

  function stop() {
    stopped = true;
    cancelTimers();
    jobs = [];
    byFn.clear();
    resolveDrain();
    if (observer) observer.disconnect();
  }

  // ── Feeds and traversal helpers ──

  function feed(wake) {
    init();
    var f = {
      wake: wake || null, full: true, pending: true, nodes: [], retouch: new WeakSet(), queued: new WeakSet(),
      take: function () {
        var b = { full: f.full, nodes: f.nodes, retouch: f.retouch };
        f.full = false; f.pending = false; f.nodes = [];
        f.retouch = new WeakSet(); f.queued = new WeakSet();
        return b;
      }
    };
    feeds.push(f);
    return f;
  }

  // Document split into subtrees so one selector query stays small.
  function fullRoots() {
    var out = [];
    var q = [[document.documentElement, 0]];
    for (var qi = 0; qi < q.length; qi++) {
      var el = q[qi][0], d = q[qi][1];
      if (d < SPLIT_DEPTH && el.firstElementChild && q.length < SPLIT_MAX) {
        out.push({ el: el, self: true });
        for (var c = el.firstElementChild; c; c = c.nextElementSibling) q.push([c, d + 1]);
      } else {
        out.push({ el: el, self: false });
      }
    }
    return out;
  }

  // Elements of the batch matching sel that are not in `seen` yet. A WeakSet
  // dedupes across rounds; elements whose text changed are visited again.
  function* matches(batch, sel, seen, detached) {
    var roots;
    if (batch.full) roots = fullRoots();
    else {
      // A root inside another root of the same batch is covered by its ancestor's
      // query, so enumerating it again would only repeat work.
      var inBatch = new Set(batch.nodes);
      roots = [];
      for (var b = 0; b < batch.nodes.length; b++) {
        var node = batch.nodes[b];
        var covered = false;
        if (!batch.retouch.has(node)) {
          for (var up = node.parentElement; up; up = up.parentElement) {
            if (inBatch.has(up)) { covered = true; break; }
          }
        }
        if (!covered) roots.push({ el: node, self: false });
      }
    }
    for (var i = 0; i < roots.length; i++) {
      var r = roots[i].el;
      if (!detached && !r.isConnected) continue;
      var retouched = batch.retouch.has(r);
      if (r.matches(sel) && (retouched || !seen.has(r))) { seen.add(r); yield r; }
      if (roots[i].self) continue;
      var list = r.querySelectorAll(sel);
      for (var k = 0; k < list.length; k++) {
        var e = list[k];
        if (seen.has(e)) continue;
        seen.add(e);
        yield e;
      }
    }
  }

  return { schedule: schedule, later: later, flush: flush, onLeave: onLeave, feed: feed, matches: matches, stop: stop,
           // exposed for the fake-timer harness only
           _state: function () { return { jobs: jobs.length, forced: forced, stopped: stopped }; } };
})();
