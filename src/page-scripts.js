/**
 * page-scripts.js — Scripts evaluated AFTER page load via Runtime.evaluate.
 * Scans the live DOM for cookies, trackers, dark patterns, storage, and links.
 *
 * Each function returns a string that can be passed to Runtime.evaluate.
 * The expression must return a JSON-serializable value.
 */

import { TRACKER_DOMAINS, DARK_PATTERNS, TRACKING_PARAMS, SUSPICIOUS_STORAGE_PATTERNS } from './data.js';

/**
 * Build the mega evaluation script that runs all page-level detectors
 * and returns results as a single JSON object.
 */
export function getPageScript() {
  // We inline the data into the script since it runs in page context
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
    const pageHost = location.hostname;
    const parsed = cookies.map(c => {
      const eqIdx = c.indexOf('=');
      const name = eqIdx > -1 ? c.substring(0, eqIdx).trim() : c.trim();
      const value = eqIdx > -1 ? c.substring(eqIdx + 1).trim() : '';
      return { name, valueLength: value.length };
    });
    results.cookies = {
      total: parsed.length,
      items: parsed.slice(0, 50), // cap for sanity
    };
  } catch (e) {
    results.cookies = { total: 0, items: [], error: e.message };
  }

  // --- 2. TRACKING PIXELS & HIDDEN ELEMENTS ---
  try {
    const trackerDomains = ${trackerDomainsJSON};
    const pixels = [];
    const hiddenIframes = [];

    // Scan images: 1x1 or hidden
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

    // Scan iframes: hidden or tiny
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

    // Classify tracker domains
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

    // Confirm-shaming: check button/link text
    const clickableText = [];
    document.querySelectorAll('a, button, [role="button"]').forEach(el => {
      clickableText.push((el.textContent || '').trim().toLowerCase());
    });
    const shamingPhrases = darkPatterns.confirm_shaming || [];
    const shamingMatches = [];
    for (const phrase of shamingPhrases) {
      for (const text of clickableText) {
        if (text.includes(phrase)) {
          shamingMatches.push(text.substring(0, 80));
        }
      }
    }
    if (shamingMatches.length > 0) {
      detected.push({ type: 'confirm_shaming', matches: shamingMatches.slice(0, 5) });
      score += 20;
    }

    // Fake urgency: regex scan on body text
    const urgencyPhrases = darkPatterns.fake_urgency || [];
    const urgencyMatches = [];
    for (const phrase of urgencyPhrases) {
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
    const timerPhrases = darkPatterns.countdown_timer || [];
    const timerMatches = [];
    for (const phrase of timerPhrases) {
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
      const labelLower = label.toLowerCase();
      if (/newsletter|marketing|subscribe|promo|agree|opt.?in|email/i.test(labelLower)) {
        preChecked.push(label.substring(0, 100));
      }
    });
    if (preChecked.length > 0) {
      detected.push({ type: 'pre_checked_boxes', matches: preChecked.slice(0, 5) });
      score += 20;
    }

    // Hidden unsubscribe (tiny text)
    const hiddenUnsub = [];
    document.querySelectorAll('a, span, p, div').forEach(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text.includes('unsubscribe') || text.includes('opt out') || text.includes('opt-out')) {
        const style = getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize < 10) {
          hiddenUnsub.push({ text: text.substring(0, 60), fontSize: fontSize + 'px' });
        }
      }
    });
    if (hiddenUnsub.length > 0) {
      detected.push({ type: 'hidden_unsubscribe', matches: hiddenUnsub.slice(0, 3) });
      score += 20;
    }

    results.dark_patterns = {
      score: Math.min(score, 100),
      detected,
    };
  } catch (e) {
    results.dark_patterns = { score: 0, detected: [], error: e.message };
  }

  // --- 4. STORAGE ---
  try {
    const suspiciousPatterns = ${JSON.stringify(suspiciousPatternsSource)};
    const suspiciousFlags = ${JSON.stringify(suspiciousFlagsSource)};

    function scanStorage(storage, name) {
      const keys = [];
      const flagged = [];
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          const value = storage.getItem(key) || '';
          keys.push({ key, valueLength: value.length });

          // Check if key or value matches suspicious patterns
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
      localStorage: scanStorage(localStorage, 'localStorage'),
      sessionStorage: scanStorage(sessionStorage, 'sessionStorage'),
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
        // Check tracking params
        const foundParams = trackingParams.filter(p => url.searchParams.has(p));
        if (foundParams.length > 0) {
          withTracking++;
          if (trackingDetails.length < 10) {
            trackingDetails.push({
              href: a.href.substring(0, 150),
              params: foundParams,
            });
          }
        }
        // Check redirect wrappers
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

  return JSON.stringify(results);
})();
`;
}
