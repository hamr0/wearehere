/**
 * scripts.js — Page-context scripts for privacy detection.
 *
 * getInitScript() — inject BEFORE navigation (fingerprint + beacon wrappers)
 * getPageScript() — evaluate AFTER page load (cookies, trackers, dark patterns, storage, links, ToS)
 *
 * Both return self-contained strings that run in the browser page context.
 */

import {
  TRACKER_DOMAINS, DARK_PATTERNS, TRACKING_PARAMS,
  SUSPICIOUS_STORAGE_PATTERNS,
} from './data.js';

/**
 * Returns init script source — wraps browser APIs to detect fingerprinting
 * and beacon calls before any page script runs.
 * Creates window.__wearehere for result collection.
 */
export function getInitScript() {
  return `
(function() {
  'use strict';

  window.__wearehere = {
    fingerprinting: [],
    beacons: [],
  };

  function wrapMethod(obj, prop, category) {
    if (!obj || !obj[prop]) return;
    const original = obj[prop];
    obj[prop] = function(...args) {
      try {
        const stack = new Error().stack || '';
        const frames = stack.split('\\n').slice(1, 4).map(f => f.trim());
        window.__wearehere.fingerprinting.push({
          api: category + '.' + prop,
          category: category,
          timestamp: Date.now(),
          stack: frames,
        });
      } catch {}
      return original.apply(this, args);
    };
  }

  function wrapGetter(obj, prop, category) {
    if (!obj) return;
    const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
    if (!descriptor || !descriptor.get) return;
    const originalGet = descriptor.get;
    Object.defineProperty(obj, prop, {
      get: function() {
        try {
          const stack = new Error().stack || '';
          const frames = stack.split('\\n').slice(1, 4).map(f => f.trim());
          window.__wearehere.fingerprinting.push({
            api: category + '.' + prop,
            category: category,
            timestamp: Date.now(),
            stack: frames,
          });
        } catch {}
        return originalGet.call(this);
      },
      configurable: true,
    });
  }

  // Canvas
  if (typeof HTMLCanvasElement !== 'undefined') {
    wrapMethod(HTMLCanvasElement.prototype, 'toDataURL', 'Canvas');
    wrapMethod(HTMLCanvasElement.prototype, 'toBlob', 'Canvas');
  }
  if (typeof CanvasRenderingContext2D !== 'undefined') {
    wrapMethod(CanvasRenderingContext2D.prototype, 'getImageData', 'Canvas');
  }

  // WebGL
  if (typeof WebGLRenderingContext !== 'undefined') {
    wrapMethod(WebGLRenderingContext.prototype, 'getParameter', 'WebGL');
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    wrapMethod(WebGL2RenderingContext.prototype, 'getParameter', 'WebGL');
  }

  // AudioContext
  if (typeof AudioContext !== 'undefined') {
    wrapMethod(AudioContext.prototype, 'createOscillator', 'AudioContext');
  }
  if (typeof OfflineAudioContext !== 'undefined') {
    wrapMethod(OfflineAudioContext.prototype, 'startRendering', 'AudioContext');
  }

  // Navigator
  wrapGetter(Navigator.prototype, 'hardwareConcurrency', 'Navigator');
  wrapGetter(Navigator.prototype, 'languages', 'Navigator');
  wrapGetter(Navigator.prototype, 'platform', 'Navigator');
  wrapGetter(Navigator.prototype, 'deviceMemory', 'Navigator');

  // Screen
  if (typeof Screen !== 'undefined') {
    wrapGetter(Screen.prototype, 'colorDepth', 'Screen');
    wrapGetter(Screen.prototype, 'pixelDepth', 'Screen');
  }

  // Beacon interception
  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      try {
        window.__wearehere.beacons.push({
          url: url,
          dataSize: data ? (typeof data === 'string' ? data.length : 0) : 0,
          timestamp: Date.now(),
        });
      } catch {}
      return originalSendBeacon(url, data);
    };
  }

})();
`;
}

/**
 * Returns the page-level detection script that scans the live DOM.
 * Detects: cookies, trackers, dark patterns, storage, links, third-party scripts, forms, ToS.
 */
export function getPageScript() {
  const trackerDomainsJSON = JSON.stringify(TRACKER_DOMAINS);
  const trackingParamsJSON = JSON.stringify(TRACKING_PARAMS);
  const darkPatternsJSON = JSON.stringify(DARK_PATTERNS);
  const suspiciousPatternsSource = SUSPICIOUS_STORAGE_PATTERNS.map(r => r.source);
  const suspiciousFlagsSource = SUSPICIOUS_STORAGE_PATTERNS.map(r => r.flags);

  return `
(function() {
  'use strict';
  const results = {};

  // --- 1. COOKIES ---
  try {
    const cookieStr = document.cookie || '';
    const cookies = cookieStr ? cookieStr.split(';').map(c => c.trim()).filter(Boolean) : [];
    const parsed = cookies.map(c => {
      const eqIdx = c.indexOf('=');
      const name = eqIdx > -1 ? c.substring(0, eqIdx).trim() : c.trim();
      const value = eqIdx > -1 ? c.substring(eqIdx + 1).trim() : '';
      return { name, valueLength: value.length };
    });
    results.cookies = { total: parsed.length, items: parsed.slice(0, 50) };
  } catch (e) {
    results.cookies = { total: 0, items: [], error: e.message };
  }

  // --- 2. TRACKING PIXELS & HIDDEN ELEMENTS ---
  try {
    const trackerDomains = ${trackerDomainsJSON};
    const pixels = [];
    const hiddenIframes = [];

    document.querySelectorAll('img').forEach(img => {
      const isPixel = (img.naturalWidth <= 1 && img.naturalHeight <= 1) ||
                      (img.width <= 1 && img.height <= 1) ||
                      img.style.display === 'none' ||
                      img.style.visibility === 'hidden' ||
                      (img.offsetWidth <= 1 && img.offsetHeight <= 1);
      if (isPixel && img.src) {
        let domain = '';
        try { domain = new URL(img.src).hostname; } catch {}
        pixels.push({ src: img.src.substring(0, 200), domain });
      }
    });

    document.querySelectorAll('iframe').forEach(iframe => {
      const isHidden = (iframe.width <= 1 || iframe.height <= 1) ||
                       iframe.style.display === 'none' ||
                       iframe.style.visibility === 'hidden' ||
                       (iframe.offsetWidth <= 1 && iframe.offsetHeight <= 1);
      if (isHidden && iframe.src) {
        let domain = '';
        try { domain = new URL(iframe.src).hostname; } catch {}
        hiddenIframes.push({ src: iframe.src.substring(0, 200), domain });
      }
    });

    const trackerPixels = pixels.filter(p =>
      trackerDomains.some(td => p.domain.includes(td) || p.src.includes(td))
    );

    results.trackers = {
      pixels: trackerPixels.length,
      all_hidden_images: pixels.length,
      hidden_iframes: hiddenIframes.length,
      pixel_domains: [...new Set(trackerPixels.map(p => p.domain))].slice(0, 20),
      iframe_domains: [...new Set(hiddenIframes.map(i => i.domain))].slice(0, 20),
    };
  } catch (e) {
    results.trackers = { pixels: 0, hidden_iframes: 0, error: e.message };
  }

  // --- 3. DARK PATTERNS ---
  try {
    const darkPatterns = ${darkPatternsJSON};
    const bodyText = document.body ? document.body.innerText.toLowerCase() : '';
    const detected = [];
    let score = 0;

    // Confirm-shaming
    const clickableText = [];
    document.querySelectorAll('a, button, [role="button"]').forEach(el => {
      clickableText.push((el.textContent || '').trim().toLowerCase());
    });
    const shamingMatches = [];
    for (const phrase of (darkPatterns.confirm_shaming || [])) {
      for (const text of clickableText) {
        if (text.includes(phrase)) shamingMatches.push(text.substring(0, 80));
      }
    }
    if (shamingMatches.length > 0) {
      detected.push({ type: 'confirm_shaming', matches: shamingMatches.slice(0, 5) });
      score += 20;
    }

    // Fake urgency
    const urgencyMatches = [];
    for (const phrase of (darkPatterns.fake_urgency || [])) {
      try {
        const re = new RegExp(phrase, 'i');
        const match = bodyText.match(re);
        if (match) urgencyMatches.push(match[0].substring(0, 80));
      } catch {}
    }
    if (urgencyMatches.length > 0) {
      detected.push({ type: 'fake_urgency', matches: [...new Set(urgencyMatches)].slice(0, 5) });
      score += 20;
    }

    // Countdown timers
    const timerMatches = [];
    for (const phrase of (darkPatterns.countdown_timer || [])) {
      try {
        const re = new RegExp(phrase, 'i');
        const match = bodyText.match(re);
        if (match) timerMatches.push(match[0].substring(0, 40));
      } catch {}
    }
    if (timerMatches.length > 0) {
      detected.push({ type: 'countdown_timer', matches: [...new Set(timerMatches)].slice(0, 3) });
      score += 20;
    }

    // Pre-checked checkboxes
    const preChecked = [];
    document.querySelectorAll('input[type="checkbox"][checked], input[type="checkbox"]:checked').forEach(cb => {
      const label = cb.closest('label')?.textContent?.trim() ||
                    cb.parentElement?.textContent?.trim() || '';
      if (/newsletter|marketing|subscribe|promo|agree|opt.?in|email/i.test(label.toLowerCase())) {
        preChecked.push(label.substring(0, 100));
      }
    });
    if (preChecked.length > 0) {
      detected.push({ type: 'pre_checked_boxes', matches: preChecked.slice(0, 5) });
      score += 20;
    }

    // Hidden unsubscribe
    const hiddenUnsub = [];
    document.querySelectorAll('a, span, p, div').forEach(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.includes('unsubscribe') || text.includes('opt out') || text.includes('opt-out')) {
        const style = getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize < 10) hiddenUnsub.push({ text: text.substring(0, 60), fontSize: fontSize + 'px' });
      }
    });
    if (hiddenUnsub.length > 0) {
      detected.push({ type: 'hidden_unsubscribe', matches: hiddenUnsub.slice(0, 3) });
      score += 20;
    }

    results.dark_patterns = { score: Math.min(score, 100), detected };
  } catch (e) {
    results.dark_patterns = { score: 0, detected: [], error: e.message };
  }

  // --- 4. STORAGE ---
  try {
    const suspiciousPatterns = ${JSON.stringify(suspiciousPatternsSource)};
    const suspiciousFlags = ${JSON.stringify(suspiciousFlagsSource)};

    function scanStorage(storage) {
      const keys = [];
      const flagged = [];
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          const value = storage.getItem(key) || '';
          keys.push({ key, valueLength: value.length });
          for (let p = 0; p < suspiciousPatterns.length; p++) {
            const re = new RegExp(suspiciousPatterns[p], suspiciousFlags[p]);
            if (re.test(key) || re.test(value)) {
              flagged.push({ key, matchedPattern: suspiciousPatterns[p], valuePreview: value.substring(0, 60) });
              break;
            }
          }
        }
      } catch {}
      return { total: keys.length, flagged: flagged.slice(0, 20) };
    }

    results.storage = {
      localStorage: scanStorage(localStorage),
      sessionStorage: scanStorage(sessionStorage),
    };
  } catch (e) {
    results.storage = { error: e.message };
  }

  // --- 5. LINKS ---
  try {
    const trackingParams = ${trackingParamsJSON};
    const links = document.querySelectorAll('a[href]');
    let withTracking = 0;
    let redirectWrappers = 0;
    const trackingDetails = [];

    links.forEach(a => {
      try {
        const url = new URL(a.href, location.origin);
        const foundParams = trackingParams.filter(p => url.searchParams.has(p));
        if (foundParams.length > 0) {
          withTracking++;
          if (trackingDetails.length < 10) {
            trackingDetails.push({ href: a.href.substring(0, 150), params: foundParams });
          }
        }
        const host = url.hostname;
        if (host.includes('google.com/url') || host.includes('l.facebook.com') ||
            host.includes('lm.facebook.com') || host === 't.co' ||
            host === 'bit.ly' || host === 'tinyurl.com') {
          redirectWrappers++;
        }
      } catch {}
    });

    results.links = {
      total: links.length,
      with_tracking_params: withTracking,
      redirect_wrappers: redirectWrappers,
      details: trackingDetails,
    };
  } catch (e) {
    results.links = { total: 0, with_tracking_params: 0, redirect_wrappers: 0, error: e.message };
  }

  // --- 6. THIRD-PARTY SCRIPTS ---
  try {
    const pageHost = location.hostname;
    const scripts = [];
    document.querySelectorAll('script[src]').forEach(s => {
      try {
        const url = new URL(s.src);
        if (url.hostname !== pageHost && !url.hostname.endsWith('.' + pageHost)) {
          scripts.push({ src: s.src.substring(0, 200), domain: url.hostname });
        }
      } catch {}
    });
    results.third_party_scripts = {
      total: scripts.length,
      domains: [...new Set(scripts.map(s => s.domain))].slice(0, 30),
    };
  } catch (e) {
    results.third_party_scripts = { total: 0, domains: [], error: e.message };
  }

  // --- 7. FORMS ---
  try {
    const fields = [];
    document.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return;
      const label = el.getAttribute('aria-label') ||
                    (el.id && document.querySelector('label[for="' + el.id + '"]')?.textContent?.trim()) ||
                    el.placeholder || el.name || el.type || 'unknown';
      fields.push({ type: el.type || el.tagName.toLowerCase(), label: label.substring(0, 60) });
    });
    results.forms = { fields: fields.slice(0, 15) };
  } catch (e) {
    results.forms = { fields: [], error: e.message };
  }

  // --- 8. TOS LINKS ---
  try {
    const tosLinks = [];
    const tosPatterns = /privacy|terms|tos|legal|cookie.?policy|data.?policy/i;
    document.querySelectorAll('a[href]').forEach(a => {
      const text = (a.textContent || '').trim().toLowerCase();
      const href = a.href || '';
      if (tosPatterns.test(text) || tosPatterns.test(href)) {
        tosLinks.push({ href: href.substring(0, 300), text: text.substring(0, 80) });
      }
    });
    results.tos_links = tosLinks.slice(0, 10);
  } catch (e) {
    results.tos_links = [];
  }

  return JSON.stringify(results);
})();
`;
}

