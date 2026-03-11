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

  function hit(pattern, key) {
    if (seen[key]) return;
    seen[key] = true;
    counts[pattern]++;
  }

  // --- 1. Countdown timers (structural: digits + colons, timer classes) ---
  function scanCountdowns() {
    var timerSel = "[class*='timer'],[class*='countdown'],[class*='clock'],[class*='Timer'],[class*='Countdown'],[class*='Clock'],[id*='timer'],[id*='countdown'],[data-countdown],[data-timer],[data-end],[data-expire]";
    var timerEls = document.querySelectorAll(timerSel);
    for (var i = 0; i < timerEls.length; i++) {
      var t = (timerEls[i].innerText || "").trim();
      if (t.length > 0 && /\d/.test(t)) {
        hit("countdown", "timer:" + i);
      }
    }

    var timeRe = /\d{1,2}\s*[:．]\s*\d{2}\s*[:．]\s*\d{2}/;
    var els = document.querySelectorAll("span, div, p");
    for (var j = 0; j < els.length; j++) {
      if (els[j].children.length > 5) continue;
      var text = (els[j].innerText || "").trim();
      if (text.length < 5 || text.length > 100) continue;
      if (timeRe.test(text)) {
        hit("countdown", "time:" + text.slice(0, 30));
      }
    }
  }

  // --- 2. Discount pressure (structural: %, currency symbols, "sale" classes) ---
  function scanDiscounts() {
    var els = document.querySelectorAll("span, div, p, a, strong, b, em, small, [class*='sale'],[class*='Sale'],[class*='deal'],[class*='Deal'],[class*='discount'],[class*='Discount'],[class*='promo'],[class*='Promo'],[class*='flash'],[class*='Flash'],[class*='offer'],[class*='Offer'],[class*='price'],[class*='Price']");
    var discountRe = /\d+\s*%\s*(off|korting|rabatt|remise|de\s+r[eé]duction)?/i;
    var strikeRe = /line-through/;

    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var text = (el.innerText || "").trim();
      if (text.length < 2 || text.length > 150) continue;

      if (discountRe.test(text)) {
        hit("discount", "pct:" + text.slice(0, 30));
        continue;
      }

      var style = null;
      try { style = window.getComputedStyle(el); } catch (e) { continue; }
      if (style && strikeRe.test(style.textDecorationLine || style.textDecoration || "")) {
        if (/[\$€£¥₹]\s*\d|\d\s*[\$€£¥₹]/.test(text)) {
          hit("discount", "strike:" + text.slice(0, 30));
        }
      }
    }
  }

  // --- 3. Scarcity & social proof (structural) ---
  function scanScarcity() {
    var els = document.querySelectorAll("span, div, p, a, small, strong, [class*='stock'],[class*='sold'],[class*='left'],[class*='demand'],[class*='urgency'],[class*='scarcity'],[class*='badge']");
    var numAction = /\b\d[\d,.]*\s*\+?\s*(sold|bought|orders?|verkocht|besteld|vendu|gekauft|left|remaining|viewing|watching|people|personen|personer)\b/i;
    var stockRe = /\b(only|nog|nur|seulement)\s+\d+\s/i;

    for (var i = 0; i < els.length; i++) {
      var text = (els[i].innerText || "").trim();
      if (text.length < 4 || text.length > 100) continue;
      if (numAction.test(text) || stockRe.test(text)) {
        hit("scarcity", "sc:" + text.slice(0, 30));
      }
    }
  }

  // --- 4. Pre-checked checkboxes ---
  function scanPrechecked() {
    var susWords = /newsletter|marketing|subscribe|promo|opt.?in|updates|offers|agree|consent|plan|protection|warranty|verzeker|nieuwsbrief|abonner|souscrire|inscri/i;

    var checks = document.querySelectorAll("input[type='checkbox']");
    for (var i = 0; i < checks.length; i++) {
      if (!checks[i].checked) continue;
      var label = findLabel(checks[i]);
      if (label && susWords.test(label)) {
        hit("prechecked", "cb:" + i);
      }
    }

    var ariaChecked = document.querySelectorAll("[role='checkbox'][aria-checked='true'], [role='switch'][aria-checked='true']");
    for (var j = 0; j < ariaChecked.length; j++) {
      var text = (ariaChecked[j].innerText || "").trim();
      if (!text) {
        var parent = ariaChecked[j].closest("label, [class*='checkbox'], [class*='check']");
        if (parent) text = (parent.innerText || "").trim();
      }
      if (text && susWords.test(text)) {
        hit("prechecked", "aria:" + j);
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
  function scanConfirmShaming() {
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
    var clickables = document.querySelectorAll("a, button, [role='button'], [class*='btn'], [class*='dismiss'], [class*='decline'], [class*='close'], [class*='cancel'], [class*='reject'], [class*='skip']");
    for (var i = 0; i < clickables.length; i++) {
      var text = (clickables[i].textContent || "").trim();
      if (text.length > 100 || text.length < 4) continue;
      for (var p = 0; p < phrases.length; p++) {
        if (phrases[p].test(text)) {
          hit("shaming", "sh:" + i);
          break;
        }
      }
    }
  }

  // --- 6. Hidden unsubscribe ---
  function scanHiddenUnsub() {
    var links = document.querySelectorAll("a");
    for (var i = 0; i < links.length; i++) {
      var text = (links[i].textContent || "").trim();
      if (!/unsubscribe|opt.?out|afmelden|uitschrijven|d[eé]sabonner/i.test(text)) continue;
      var style = window.getComputedStyle(links[i]);
      var size = parseFloat(style.fontSize);
      var opacity = parseFloat(style.opacity);
      if (size < 10 || opacity < 0.5 || isLowContrast(style.color, findBg(links[i]))) {
        hit("hidden-unsub", "unsub:" + i);
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
  function safeScan(name, fn) {
    try { fn(); } catch (e) {
      console.warn("[weareplayed] " + name + " error:", e.message);
    }
  }

  function scan() {
    for (var k in counts) counts[k] = 0;
    seen = {};

    safeScan("countdowns", scanCountdowns);
    safeScan("discounts", scanDiscounts);
    safeScan("scarcity", scanScarcity);
    safeScan("prechecked", scanPrechecked);
    safeScan("shaming", scanConfirmShaming);
    safeScan("hidden-unsub", scanHiddenUnsub);

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
      if (observer) observer.disconnect();
    }
  }

  setTimeout(scan, 2000);

  var rescanTimer = null;
  var observer = new MutationObserver(function () {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(scan, 3000);
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
