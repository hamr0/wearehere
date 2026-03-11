/**
 * wearehere — Privacy assessment for any website.
 *
 * Takes a barebrowse page object, navigates, scans, and returns
 * a compact privacy assessment with score, risk level, and
 * per-category breakdown.
 *
 * Usage:
 *   import { assess } from 'wearehere';
 *   import { connect } from 'barebrowse';
 *
 *   const page = await connect({ mode: 'headless' });
 *   const result = await assess(page, 'https://example.com');
 *   console.log(result.score, result.risk);
 *   await page.close();
 */

import { getInitScript, getPageScript } from './scripts.js';
import { computeVerdict } from './scoring.js';
import {
  NET_TRACKER_DOMAINS, NET_BROKER_META, NET_DOMAIN_PATTERNS,
  NET_PURPOSE_DOMAINS, TOS_PATHS, getRootDomain,
  classifyNetworkDomain, scanText,
} from './data.js';

/**
 * Run a full privacy assessment on a URL.
 *
 * @param {object} page - A barebrowse page object (from connect())
 * @param {string} url - URL to scan
 * @param {object} [opts]
 * @param {number} [opts.timeout] - Navigation timeout in ms (default: 30000)
 * @param {number} [opts.settle] - Wait for trackers to load, in ms (default: 3000)
 * @param {boolean} [opts.scanTerms] - Scan ToS/privacy policy (default: true)
 * @returns {Promise<object>} Compact privacy assessment
 */
export async function assess(page, url, opts = {}) {
  const timeout = opts.timeout || 30000;
  const settle = opts.settle || 3000;
  const scanTerms = opts.scanTerms !== false;
  const session = page.cdp;

  // Track network requests via CDP
  const networkRequests = [];
  const networkSession = session.session ? session.session(session._sessionId) : session;

  const onRequest = (params) => {
    try {
      const reqUrl = params.request?.url || params.documentURL || '';
      if (reqUrl) {
        const hostname = new URL(reqUrl).hostname;
        networkRequests.push({ hostname, type: params.type || 'other' });
      }
    } catch {}
  };

  try {
    networkSession.on('Network.requestWillBeSent', onRequest);
  } catch {}

  // Inject init scripts before navigation (fingerprint + beacon wrappers)
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: getInitScript(),
  });

  // Navigate
  await page.goto(url, timeout);

  // Wait for network to settle
  try {
    await page.waitForNetworkIdle({ timeout: settle, idle: 1000 });
  } catch {}

  // Run page-level detection scripts
  const { result: pageResult } = await session.send('Runtime.evaluate', {
    expression: getPageScript(),
    returnByValue: true,
  });

  let pageData = {};
  try {
    pageData = JSON.parse(pageResult.value || '{}');
  } catch {
    pageData = {};
  }

  // Collect init script results (fingerprinting, beacons)
  let initData = { fingerprinting: [], beacons: [] };
  const { result: initResult } = await session.send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__wearehere || {})',
    returnByValue: true,
  });
  try {
    initData = JSON.parse(initResult.value || '{}');
  } catch {}

  // Get cookies via CDP
  let cdpCookies = [];
  try {
    const { cookies } = await session.send('Network.getCookies', { urls: [url] });
    cdpCookies = cookies || [];
  } catch {}

  // Scan ToS if enabled
  let tosResult = null;
  if (scanTerms) {
    tosResult = await scanToS(page, url, pageData.tos_links || []);
  }

  // Clean up network listener
  try {
    networkSession.off('Network.requestWillBeSent', onRequest);
  } catch {}

  return buildAssessment(url, pageData, initData, cdpCookies, networkRequests, tosResult);
}

// --- ToS scanning ---

async function scanToS(page, url, pageLinks) {
  const session = page.cdp;
  const host = new URL(url).hostname;
  const origin = new URL(url).origin;

  // Collect candidate URLs: page links + common paths
  const candidates = [];
  for (const link of pageLinks) {
    if (link.href && /privacy/i.test(link.text + link.href)) {
      candidates.push(link.href);
    }
  }
  for (const path of TOS_PATHS) {
    if (/privacy/i.test(path)) candidates.push(origin + path);
  }
  // Add terms links too
  for (const link of pageLinks) {
    if (link.href && /terms|tos|legal/i.test(link.text + link.href)) {
      candidates.push(link.href);
    }
  }
  for (const path of TOS_PATHS) {
    if (/terms|tos|legal/i.test(path)) candidates.push(origin + path);
  }

  // Try to fetch and scan the first reachable privacy/terms page
  const seen = new Set();
  let bestResult = null;

  for (const candidate of candidates.slice(0, 8)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    try {
      const text = await fetchPageText(session, candidate);
      if (text && text.length > 500) {
        const result = scanText(text);
        if (result.score > 0 && (!bestResult || result.score > bestResult.score)) {
          bestResult = result;
        }
        if (result.score > 20) break; // good enough
      }
    } catch {}
  }

  if (bestResult) {
    return { found: true, score: bestResult.score, flagged: bestResult.items, total: bestResult.total };
  }
  return { found: false };
}

async function fetchPageText(session, url) {
  try {
    const { result } = await session.send('Runtime.evaluate', {
      expression: `
        fetch(${JSON.stringify(url)}, { credentials: 'omit' })
          .then(r => r.text())
          .then(html => {
            const doc = new DOMParser().parseFromString(html, 'text/html');
            return (doc.body?.innerText || '').substring(0, 50000);
          })
          .catch(() => '')
      `,
      returnByValue: true,
      awaitPromise: true,
    });
    return result.value || '';
  } catch {
    return '';
  }
}

// --- Assessment builder ---

function buildAssessment(url, pageData, initData, cdpCookies, networkRequests, tosResult) {
  const host = new URL(url).hostname;

  // --- Cookies ---
  const firstParty = cdpCookies.filter(c =>
    c.domain.includes(host) || host.includes(c.domain.replace(/^\./, ''))
  );
  const thirdParty = cdpCookies.filter(c =>
    !c.domain.includes(host) && !host.includes(c.domain.replace(/^\./, ''))
  );
  const persistent = cdpCookies.filter(c => !c.session);
  let longestDays = 0;
  for (const c of persistent) {
    if (c.expires) {
      const days = Math.round((c.expires * 1000 - Date.now()) / 86400000);
      if (days > longestDays) longestDays = days;
    }
  }

  // --- Fingerprinting ---
  const fpCalls = initData.fingerprinting || [];
  const byCat = {};
  for (const call of fpCalls) {
    if (!byCat[call.category]) byCat[call.category] = { count: 0, apis: new Set() };
    byCat[call.category].count++;
    byCat[call.category].apis.add(call.api);
  }
  const fpMethods = Object.entries(byCat).map(([technique, d]) => ({
    technique, apis: [...d.apis], calls: d.count,
  }));

  // --- Trackers ---
  const beacons = initData.beacons || [];
  const pixelCount = pageData.trackers?.pixels || 0;
  const iframeCount = pageData.trackers?.hidden_iframes || 0;
  const trackerTotal = pixelCount + beacons.length + iframeCount;

  // --- Dark patterns ---
  const dp = pageData.dark_patterns || { score: 0, detected: [] };

  // --- Storage ---
  const ls = pageData.storage?.localStorage || { total: 0, flagged: [] };
  const ss = pageData.storage?.sessionStorage || { total: 0, flagged: [] };
  const allFlagged = [...(ls.flagged || []), ...(ss.flagged || [])];

  // --- Links ---
  const linkData = pageData.links || { total: 0, with_tracking_params: 0, redirect_wrappers: 0 };
  const linkPct = linkData.total > 0
    ? Math.round((linkData.with_tracking_params / linkData.total) * 100) : 0;

  // --- Network ---
  const hostRoot = getRootDomain(host);
  const thirdPartyDomains = {};
  let brokerCount = 0;
  const brokersSeen = new Set();
  for (const req of networkRequests) {
    const reqRoot = getRootDomain(req.hostname);
    if (reqRoot === hostRoot) continue;
    if (thirdPartyDomains[req.hostname]) continue;
    const classified = classifyNetworkDomain(req.hostname);
    thirdPartyDomains[req.hostname] = classified;
    if (NET_BROKER_META[reqRoot] || NET_BROKER_META[req.hostname]) {
      if (!brokersSeen.has(reqRoot)) {
        brokersSeen.add(reqRoot);
        brokerCount++;
      }
    }
  }
  const trackerDomains = Object.values(thirdPartyDomains).filter(d => d.risky).length;

  // --- Forms ---
  const formFields = pageData.forms?.fields || [];
  const scriptDomains = pageData.third_party_scripts?.domains || [];
  const trackerScriptCount = scriptDomains.filter(d => {
    const root = getRootDomain(d);
    return NET_TRACKER_DOMAINS[root] || NET_TRACKER_DOMAINS[d];
  }).length;

  // Build normalized report for computeVerdict
  const report = {
    cookies: {
      total: cdpCookies.length,
      firstParty: firstParty.length,
      thirdParty: thirdParty.length,
      longestDays,
    },
    network: {
      trackerDomains,
      thirdPartyDomains: Object.keys(thirdPartyDomains).length,
      brokerCount,
    },
    trackers: { total: trackerTotal },
    pressure: { score: dp.score || 0 },
    fingerprinting: {
      techniques: fpMethods.length,
      techniqueNames: fpMethods.map(m => m.technique),
    },
    localData: { suspicious: allFlagged.length },
    forms: {
      fieldCount: formFields.length,
      trackersWhileTyping: formFields.length > 0 ? trackerScriptCount : 0,
    },
    linkTracking: { percentage: linkPct },
    tos: tosResult || { found: false },
  };

  const verdict = computeVerdict(report);

  return {
    site: host,
    url,
    score: verdict.score,
    risk: verdict.risk,
    recommendation: verdict.recommendation,
    concerns: verdict.concerns,
    categories: verdict.categories,
    scanned_at: new Date().toISOString(),
  };
}

// Re-export for sub-path imports
export { computeVerdict } from './scoring.js';
export { getInitScript, getPageScript } from './scripts.js';
export { scanText, classifyNetworkDomain } from './data.js';
