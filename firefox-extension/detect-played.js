"use strict";

(function () {
  var counts = {
    countdown: 0,
    discount: 0,
    scarcity: 0,
    prechecked: 0,
    shaming: 0,
    "hidden-unsub": 0
  };
  var seen = {};
  var uid = 0;   // unique key per element for the patterns that count elements, not text

  function hit(pattern, key) {
    if (seen[key]) return;
    seen[key] = true;
    counts[pattern]++;
  }

  // Cheap gate before innerText. innerText forces layout and serializes the
  // element's whole rendered subtree; calling it on every span/div/p made
  // these scans the extension's longest repeat task on large, constantly
  // mutating pages (infinite-scroll catalogs). Every pattern below needs a
  // digit, and innerText's characters are a subset of textContent's (it
  // drops hidden text and only adds whitespace), so a textContent with no
  // digit can never match: that gate is lossless. The length gate is 4-6x
  // the visible-text caps below, so it only skips an element whose text is
  // overwhelmingly hidden/script content: an accepted, rare miss.
  var DIGIT_RE = /\d/;
  function digitCandidate(el, maxLen) {
    var tc = el.textContent;
    return !!tc && tc.length <= maxLen && DIGIT_RE.test(tc);
  }

  // Elements with digits whose rendered text is empty right now (rotating
  // tickers, collapsed panels). They can become visible without any node being
  // added, so the next round looks at them again.
  var pendingHidden = new Set();
  function noteHidden(el) {
    if (pendingHidden.size < 300) pendingHidden.add(el);
  }

  // A ticking countdown rewrites its text every second and is revisited on each
  // pass; key the hit by element so it counts once, not once per tick.
  var elIds = new WeakMap();
  function elId(el) {
    var id = elIds.get(el);
    if (id === undefined) { id = ++uid; elIds.set(el, id); }
    return id;
  }

  // --- 1. Countdown timers (structural: digits + colons, timer classes) ---
  function* scanCountdowns(batch) {
    var timerSel = "[class*='timer'],[class*='countdown'],[class*='clock'],[class*='Timer'],[class*='Countdown'],[class*='Clock'],[id*='timer'],[id*='countdown'],[data-countdown],[data-timer],[data-end],[data-expire]";
    var n = 0;
    for (var te of whSettle.matches(batch, timerSel, ws.timer)) {
      var t = (te.innerText || "").trim();
      if (!t) noteHidden(te);
      if (t.length > 0 && /\d/.test(t)) {
        hit("countdown", "timer:" + elId(te));
      }
      if (++n % 16 === 0) yield;
    }

    var timeRe = /\d{1,2}\s*[:．]\s*\d{2}\s*[:．]\s*\d{2}/;
    for (var ce of whSettle.matches(batch, "span, div, p", ws.time)) {
      if (++n % 32 === 0) yield;
      if (ce.children.length > 5) continue;
      if (!digitCandidate(ce, 400)) continue;
      var text = (ce.innerText || "").trim();
      if (!text) noteHidden(ce);
      if (text.length < 5 || text.length > 100) continue;
      if (timeRe.test(text)) {
        hit("countdown", "time:" + elId(ce));
      }
    }
  }

  // --- 2. Discount pressure (structural: %, currency symbols, "sale" classes) ---
  function* scanDiscounts(batch) {
    var discountSel = ("span, div, p, a, strong, b, em, small, [class*='sale'],[class*='Sale'],[class*='deal'],[class*='Deal'],[class*='discount'],[class*='Discount'],[class*='promo'],[class*='Promo'],[class*='flash'],[class*='Flash'],[class*='offer'],[class*='Offer'],[class*='price'],[class*='Price']");
    var n = 0;
    var discountRe = /\d+\s*%\s*(off|korting|rabatt|remise|de\s+r[eé]duction)?/i;
    var strikeRe = /line-through/;

    for (var el of whSettle.matches(batch, discountSel, ws.disc)) {
      if (++n % 32 === 0) yield;
      if (!digitCandidate(el, 600)) continue;
      var text = (el.innerText || "").trim();
      if (!text) noteHidden(el);
      if (text.length < 2 || text.length > 150) continue;

      if (discountRe.test(text)) {
        hit("discount", "pct:" + text.slice(0, 30));
        continue;
      }

      // Price text first (a regex), computed style only for prices.
      if (!/[\$€£¥₹]\s*\d|\d\s*[\$€£¥₹]/.test(text)) continue;
      var style = null;
      try { style = window.getComputedStyle(el); } catch (e) { continue; }
      if (style && strikeRe.test(style.textDecorationLine || style.textDecoration || "")) {
        hit("discount", "strike:" + text.slice(0, 30));
      }
    }
  }

  // --- 3. Scarcity & social proof (structural) ---
  function* scanScarcity(batch) {
    var scarcitySel = ("span, div, p, a, small, strong, [class*='stock'],[class*='sold'],[class*='left'],[class*='demand'],[class*='urgency'],[class*='scarcity'],[class*='badge']");
    var n = 0;
    var numAction = /\b\d[\d,.]*\s*\+?\s*(sold|bought|orders?|verkocht|besteld|vendu|gekauft|left|remaining|viewing|watching|people|personen|personer)\b/i;
    var stockRe = /\b(only|nog|nur|seulement)\s+\d+\s/i;

    for (var se of whSettle.matches(batch, scarcitySel, ws.scar)) {
      if (++n % 32 === 0) yield;
      if (!digitCandidate(se, 400)) continue;
      var text = (se.innerText || "").trim();
      if (!text) noteHidden(se);
      if (text.length < 4 || text.length > 100) continue;
      if (numAction.test(text) || stockRe.test(text)) {
        hit("scarcity", "sc:" + text.slice(0, 30));
      }
    }
  }

  // --- 4. Pre-checked checkboxes ---
  function* scanPrechecked(batch) {
    var susWords = /newsletter|marketing|subscribe|promo|opt.?in|updates|offers|agree|consent|plan|protection|warranty|verzeker|nieuwsbrief|abonner|souscrire|inscri/i;

    var n = 0;
    for (var cb of whSettle.matches(batch, "input[type='checkbox']", ws.cb)) {
      if (++n % 16 === 0) yield;
      if (!cb.checked) continue;
      var label = findLabel(cb);
      if (label && susWords.test(label)) {
        hit("prechecked", "cb:" + (++uid));
      }
    }

    for (var ac of whSettle.matches(batch, "[role='checkbox'][aria-checked='true'], [role='switch'][aria-checked='true']", ws.aria)) {
      var text = (ac.innerText || "").trim();
      if (!text) {
        var parent = ac.closest("label, [class*='checkbox'], [class*='check']");
        if (parent) text = (parent.innerText || "").trim();
      }
      if (text && susWords.test(text)) {
        hit("prechecked", "aria:" + (++uid));
      }
    }
  }

  function findLabel(input) {
    if (input.id) {
      var label = document.querySelector("label[for='" + CSS.escape(input.id) + "']");
      if (label) return label.textContent.trim();
    }
    var parent = input.closest("label");
    if (parent) return parent.textContent.trim();
    var container = input.closest("div, li, td, span");
    if (container) return container.textContent.trim().slice(0, 150);
    return null;
  }

  // --- 5. Confirm-shaming ---
  function* scanConfirmShaming(batch) {
    var phrases = [
      /no\s*,?\s*thanks?\b/i,
      /no\s*,?\s*i\s/i,
      /i\s+don'?t\s+want/i,
      /i'?ll\s+pass/i,
      /i\s+prefer\s+not/i,
      /i\s+don'?t\s+(like|need|care)/i,
      /i'?d\s+rather\s+(pay|spend|not)/i,
      /maybe\s+later/i,
      /not?\s+interested/i,
      /nee\s*,?\s*bedankt/i,
      /non\s*,?\s*merci/i,
      /nein\s*,?\s*danke/i
    ];
    var n = 0;
    var clickSel = "a, button, [role='button'], [class*='btn'], [class*='dismiss'], [class*='decline'], [class*='close'], [class*='cancel'], [class*='reject'], [class*='skip']";
    for (var cl of whSettle.matches(batch, clickSel, ws.shame)) {
      if (++n % 32 === 0) yield;
      var text = (cl.textContent || "").trim();
      if (text.length > 100 || text.length < 4) continue;
      for (var p = 0; p < phrases.length; p++) {
        if (phrases[p].test(text)) {
          hit("shaming", "sh:" + (++uid));
          break;
        }
      }
    }
  }

  // --- 6. Hidden unsubscribe ---
  function* scanHiddenUnsub(batch) {
    var n = 0;
    for (var a of whSettle.matches(batch, "a", ws.unsub)) {
      if (++n % 32 === 0) yield;
      var text = (a.textContent || "").trim();
      if (!/unsubscribe|opt.?out|afmelden|uitschrijven|d[eé]sabonner/i.test(text)) continue;
      var style = window.getComputedStyle(a);
      var size = parseFloat(style.fontSize);
      var opacity = parseFloat(style.opacity);
      if (size < 10 || opacity < 0.5 || isLowContrast(style.color, findBg(a))) {
        hit("hidden-unsub", "unsub:" + (++uid));
      }
    }
  }

  function findBg(el) {
    var node = el;
    while (node && node !== document.body) {
      var bg = window.getComputedStyle(node).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      node = node.parentElement;
    }
    return "rgb(255, 255, 255)";
  }

  function isLowContrast(fg, bg) {
    var a = parseRgb(fg), b = parseRgb(bg);
    if (!a || !b) return false;
    var la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) < 2.5;
  }

  function parseRgb(s) {
    var m = s.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  }

  function lum(rgb) {
    var v = rgb.map(function (c) {
      c = c / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }

  // --- Run ---
  // Each scan is a generator so the scheduler can pause between slices. A failing
  // scan is logged and skipped, same as before.
  function* safeScanGen(name, gen) {
    try { yield* gen; } catch (e) {
      console.warn("[weareplayed] " + name + " error:", e.message);
    }
  }

  // Reporting only: everything below waits for the page to settle (see settle.js).
  // Counts accumulate across settle rounds; only nodes added since the last round
  // are scanned. A WeakSet per scan keeps an element from being scanned twice.
  var ws;
  var lastHref = null;
  function resetState() {
    for (var k in counts) counts[k] = 0;
    seen = {};
    ws = {
      timer: new WeakSet(), time: new WeakSet(), disc: new WeakSet(), scar: new WeakSet(),
      cb: new WeakSet(), aria: new WeakSet(), shame: new WeakSet(), unsub: new WeakSet()
    };
    lastHref = location.href;
  }
  resetState();

  var feed = whSettle.feed(function () { whSettle.schedule(scan); });

  var playedFinal = false;

  function sendPlayed() {
    var items = [];
    var total = 0;
    var patternCount = 0;
    for (var p in counts) {
      if (counts[p] > 0) {
        items.push({ pattern: p, count: counts[p] });
        total += counts[p];
        patternCount++;
      }
    }

    var score = Math.min(100, patternCount * 20);

    try {
      chrome.runtime.sendMessage({
        type: "detection",
        module: "played",
        data: {
          domain: location.hostname,
          items: items,
          score: score,
          total: total
        }
      });
    } catch (e) {
      // Extension context invalidated — stop observing
      whSettle.stop();
    }
  }

  // Leaving: send the tallies so far. The quick pass covers the first steps of
  // the countdown scan (timer-class elements, then span/div/p in document order).
  whSettle.onLeave(function () {
    if (playedFinal) return;
    for (var p in counts) if (counts[p] > 0) { sendPlayed(); return; }   // only report finds, never an unscanned zero
  });

  function* scan() {
    playedFinal = false;
    var batch = feed.take();
    if (location.href !== lastHref) {   // SPA navigation: start the tallies over
      resetState();
      batch = { full: true, nodes: [], retouch: batch.retouch };
    }

    if (pendingHidden.size) {
      var again = Array.from(pendingHidden);
      pendingHidden = new Set();
      if (!batch.full) {
        for (var h = 0; h < again.length; h++) batch.retouch.add(again[h]);
        batch = { full: false, nodes: batch.nodes.concat(again), retouch: batch.retouch };
      }
    }

    yield* safeScanGen("countdowns", scanCountdowns(batch));
    yield* safeScanGen("discounts", scanDiscounts(batch));
    yield* safeScanGen("scarcity", scanScarcity(batch));
    yield* safeScanGen("prechecked", scanPrechecked(batch));
    yield* safeScanGen("shaming", scanConfirmShaming(batch));
    yield* safeScanGen("hidden-unsub", scanHiddenUnsub(batch));

    sendPlayed();
    playedFinal = true;
  }

  whSettle.schedule(scan);
})();
