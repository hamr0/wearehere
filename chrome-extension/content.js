/**
 * content.js — Runs at document_start.
 * 1. Immediately injects inject.js into page context (before page scripts)
 * 2. Listens for fingerprinting/beacon relays from inject.js
 * 3. On page load, scans DOM for trackers, dark patterns, storage, links
 * 4. Sends everything to background.js
 */

// inject.js runs in MAIN world via manifest — no manual injection needed.

// --- Collected data ---
const scanData = {
  fingerprinting: [],
  beacons: [],
  trackers: null,
  darkPatterns: null,
  storage: null,
  links: null,
  thirdPartyScripts: null,
};

// --- Phase 2: Listen for inject.js postMessage ---
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data?.__wearehere) return;
  if (e.data.fingerprinting) scanData.fingerprinting.push(...e.data.fingerprinting);
  if (e.data.beacons) scanData.beacons.push(...e.data.beacons);
  sendUpdate();
});

// --- Phase 3: DOM scan on load ---
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(scanPage, 500);
} else {
  window.addEventListener('load', () => setTimeout(scanPage, 500));
}

// Also re-scan after dynamic content loads
let scanCount = 0;
const observer = new MutationObserver(() => {
  scanCount++;
  if (scanCount === 50 || scanCount === 200) scanPage();
});

function startObserver() {
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

if (document.body) startObserver();
else document.addEventListener('DOMContentLoaded', startObserver);

// --- Tracker domains ---
const TRACKER_DOMAINS = [
  'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
  'googlesyndication.com', 'doubleclick.net', 'googletagservices.com',
  'facebook.net', 'facebook.com/tr', 'fbcdn.net', 'connect.facebook.net',
  'clarity.ms', 'bat.bing.com', 'amazon-adsystem.com',
  'platform.twitter.com', 'analytics.twitter.com', 't.co',
  'hotjar.com', 'fullstory.com', 'mouseflow.com', 'luckyorange.com',
  'smartlook.com', 'logrocket.com', 'heap-analytics.com',
  'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
  'optimizely.com', 'crazyegg.com',
  'criteo.com', 'outbrain.com', 'taboola.com', 'adroll.com',
  'quantserve.com', 'scorecardresearch.com', 'bluekai.com',
  'rubiconproject.com', 'pubmatic.com', 'openx.net',
  'casalemedia.com', 'adsrvr.org', 'adnxs.com',
  'cookiebot.com', 'onetrust.com', 'trustarc.com',
  'acxiom.com', 'liveramp.com', 'lotame.com', 'bombora.com',
  'newrelic.com', 'nr-data.net', 'sentry.io', 'bugsnag.com', 'datadoghq.com',
  'snapchat.com', 'sc-static.net', 'pinterest.com', 'pinimg.com',
  'linkedin.com', 'licdn.com', 'reddit.com', 'redditstatic.com',
  'tiktok.com', 'bytedance.com',
];

// --- Dark pattern phrases ---
const SHAMING = [
  'no thanks, i don\'t want', 'no, i prefer to', 'i\'ll pass on',
  'no thanks, i\'d rather', 'i don\'t want to save', 'i prefer paying full price',
  'no, keep me uninformed', 'i don\'t like deals',
];
const URGENCY = [
  /only \d+ left/i, /\d+ people (?:are )?(?:viewing|looking|watching)/i,
  /limited time offer/i, /offer expires/i, /hurry/i, /act now/i,
  /don't miss out/i, /selling fast/i, /almost gone/i, /last chance/i,
  /ends (?:today|tonight|soon|in)/i, /while supplies last/i,
];
const TIMERS = [/\d+\s*:\s*\d+\s*:\s*\d+/, /\d+h\s*\d+m/, /\d+ hours? \d+ min/];

// --- Tracking params ---
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_eid', 'mc_cid', '_hsenc', '_hsmi', 'twclid', 'igshid',
];

// --- Suspicious storage patterns ---
const SUSPICIOUS_KEYS = [
  /[0-9a-f]{8}-[0-9a-f]{4}/i, /^_ga/, /^_fb/, /^_gcl/, /track/i,
  /^uid$/i, /analytics/i, /^mp_/, /^ajs_/, /^amplitude/i,
  /^_hjid/, /session.?id/i, /visitor.?id/i, /device.?id/i,
];

// --- DOM scanning ---
function scanPage() {
  const pageHost = location.hostname;

  // 1. Tracking pixels & hidden iframes
  const pixels = [];
  const hiddenIframes = [];

  document.querySelectorAll('img').forEach(img => {
    const isPixel = (img.naturalWidth <= 1 && img.naturalHeight <= 1) ||
                    (img.width <= 1 && img.height <= 1) ||
                    img.style.display === 'none' || img.style.visibility === 'hidden' ||
                    (img.offsetWidth <= 1 && img.offsetHeight <= 1);
    if (isPixel && img.src) {
      let domain = '';
      try { domain = new URL(img.src).hostname; } catch {}
      if (domain) pixels.push({ src: img.src.substring(0, 200), domain });
    }
  });

  document.querySelectorAll('iframe').forEach(iframe => {
    const isHidden = (iframe.width <= 1 || iframe.height <= 1) ||
                     iframe.style.display === 'none' || iframe.style.visibility === 'hidden' ||
                     (iframe.offsetWidth <= 1 && iframe.offsetHeight <= 1);
    if (isHidden && iframe.src) {
      let domain = '';
      try { domain = new URL(iframe.src).hostname; } catch {}
      if (domain && domain !== pageHost) hiddenIframes.push({ src: iframe.src.substring(0, 200), domain });
    }
  });

  const trackerPixels = pixels.filter(p =>
    TRACKER_DOMAINS.some(td => p.domain.includes(td) || p.src.includes(td))
  );

  scanData.trackers = {
    pixels: trackerPixels.length,
    allHiddenImages: pixels.length,
    hiddenIframes: hiddenIframes.length,
    pixelDomains: [...new Set(trackerPixels.map(p => p.domain))].slice(0, 20),
    iframeDomains: [...new Set(hiddenIframes.map(i => i.domain))].slice(0, 20),
  };

  // 2. Third-party scripts
  const scripts = [];
  document.querySelectorAll('script[src]').forEach(s => {
    try {
      const url = new URL(s.src);
      if (url.hostname !== pageHost && !url.hostname.endsWith('.' + pageHost)) {
        scripts.push({ domain: url.hostname });
      }
    } catch {}
  });
  scanData.thirdPartyScripts = {
    total: scripts.length,
    domains: [...new Set(scripts.map(s => s.domain))].slice(0, 30),
  };

  // 3. Dark patterns
  const bodyText = document.body ? document.body.innerText : '';
  const bodyLower = bodyText.toLowerCase();
  const detected = [];
  let dpScore = 0;

  // Confirm-shaming
  const clickableText = [];
  document.querySelectorAll('a, button, [role="button"]').forEach(el => {
    clickableText.push((el.textContent || '').trim().toLowerCase());
  });
  const shamingMatches = [];
  for (const phrase of SHAMING) {
    for (const text of clickableText) {
      if (text.includes(phrase)) shamingMatches.push(text.substring(0, 80));
    }
  }
  if (shamingMatches.length) { detected.push({ type: 'confirm_shaming', matches: shamingMatches.slice(0, 3) }); dpScore += 20; }

  // Fake urgency
  const urgencyMatches = [];
  for (const re of URGENCY) {
    const m = bodyLower.match(re);
    if (m) urgencyMatches.push(m[0]);
  }
  if (urgencyMatches.length) { detected.push({ type: 'fake_urgency', matches: [...new Set(urgencyMatches)].slice(0, 3) }); dpScore += 20; }

  // Countdown timers
  const timerMatches = [];
  for (const re of TIMERS) {
    const m = bodyText.match(re);
    if (m) timerMatches.push(m[0]);
  }
  if (timerMatches.length) { detected.push({ type: 'countdown_timer', matches: timerMatches.slice(0, 3) }); dpScore += 20; }

  // Pre-checked boxes
  const preChecked = [];
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (!cb.checked) return;
    const label = cb.closest('label')?.textContent?.trim() || cb.parentElement?.textContent?.trim() || '';
    if (/newsletter|marketing|subscribe|promo|agree|opt.?in|email/i.test(label)) {
      preChecked.push(label.substring(0, 80));
    }
  });
  if (preChecked.length) { detected.push({ type: 'pre_checked_boxes', matches: preChecked.slice(0, 3) }); dpScore += 20; }

  // Hidden unsubscribe
  const hiddenUnsub = [];
  document.querySelectorAll('a, span').forEach(el => {
    const text = (el.textContent || '').trim().toLowerCase();
    if (text.includes('unsubscribe') || text.includes('opt out') || text.includes('opt-out')) {
      try {
        const fontSize = parseFloat(getComputedStyle(el).fontSize);
        if (fontSize < 10) hiddenUnsub.push(text.substring(0, 60));
      } catch {}
    }
  });
  if (hiddenUnsub.length) { detected.push({ type: 'hidden_unsubscribe', matches: hiddenUnsub.slice(0, 3) }); dpScore += 20; }

  scanData.darkPatterns = { score: Math.min(dpScore, 100), detected };

  // 4. Storage
  function scanStorage(store) {
    const flagged = [];
    try {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        const val = store.getItem(key) || '';
        for (const re of SUSPICIOUS_KEYS) {
          if (re.test(key) || re.test(val)) {
            flagged.push({ key, why: re.source, preview: val.substring(0, 60) });
            break;
          }
        }
      }
    } catch {}
    return { total: store.length, flagged: flagged.slice(0, 15) };
  }

  try {
    scanData.storage = {
      localStorage: scanStorage(localStorage),
      sessionStorage: scanStorage(sessionStorage),
    };
  } catch {
    scanData.storage = { localStorage: { total: 0, flagged: [] }, sessionStorage: { total: 0, flagged: [] } };
  }

  // 5. Links
  const links = document.querySelectorAll('a[href]');
  let withTracking = 0;
  let redirectWrappers = 0;
  const linkDetails = [];

  links.forEach(a => {
    try {
      const url = new URL(a.href, location.origin);
      const found = TRACKING_PARAMS.filter(p => url.searchParams.has(p));
      if (found.length) {
        withTracking++;
        if (linkDetails.length < 5) linkDetails.push({ href: a.href.substring(0, 150), params: found });
      }
      const h = url.hostname;
      if (h.includes('google.com/url') || h.includes('l.facebook.com') ||
          h === 't.co' || h === 'bit.ly' || h === 'tinyurl.com') {
        redirectWrappers++;
      }
    } catch {}
  });

  scanData.links = {
    total: links.length,
    withTracking,
    redirectWrappers,
    details: linkDetails,
  };

  // 6. Find ToS/privacy links on the page for background to fetch
  const tosLinks = [];
  const tosRe = /privacy|terms|tos|legal|cookie.?policy/i;
  links.forEach(a => {
    try {
      const href = a.href;
      const text = (a.textContent || '').trim().toLowerCase();
      if ((tosRe.test(href) || tosRe.test(text)) && href.startsWith('http')) {
        tosLinks.push(href);
      }
    } catch {}
  });
  scanData.tosLinks = [...new Set(tosLinks)].slice(0, 10);

  sendUpdate();
}

// --- Send to background ---
function sendUpdate() {
  chrome.runtime.sendMessage({
    type: 'scanResult',
    domain: location.hostname,
    url: location.href,
    data: {
      fingerprinting: scanData.fingerprinting,
      beacons: scanData.beacons,
      trackers: scanData.trackers,
      darkPatterns: scanData.darkPatterns,
      storage: scanData.storage,
      links: scanData.links,
      thirdPartyScripts: scanData.thirdPartyScripts,
    },
  });
}
