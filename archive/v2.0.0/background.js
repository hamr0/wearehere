/**
 * background.js — Service worker.
 * Aggregates scan results per tab, fetches ToS, reads cookies, monitors network, computes verdict.
 *
 * Module sources:
 *   ToS scanning    → wearetosed v0.1.0 (tos-scanner.js)
 *   Fingerprinting  → wearewatched v0.1.0 (inject.js prototype wrappers)
 *   Dark patterns   → weareplayed v0.1.0 (content.js heuristics)
 *   Trackers        → wearecooked v4.0.0 (content.js domain map + pixel detection)
 *   Storage         → weareleaking v0.2.0 (content.js suspicious key patterns)
 *   Links           → wearelinked v0.3.0 (content.js tracking param list)
 *   Network         → wearebaked v0.5.1 (webRequest monitoring + data broker detection)
 *   Form scanning   → wearesilent v0.1.0 (content.js passive form field awareness)
 */

// Import modules
importScripts('tos-scanner.js');
importScripts('network-domains.js');

// --- Per-tab state + caches ---
const tabData = {};
const domainTosCache = {};

// --- Network traffic state (from wearebaked v0.5.1) ---
const networkTraffic = {
  domains: {},       // domain → { count, category, risky, brokerName, thirdPartyOn, bytesReceived, bytesSent }
  timing: {},        // requestId → startTs
  redirects: {},     // requestId → [url chain]
  finalRedirects: {}, // domain → [completed chains]
};
const MAX_FINAL_REDIRECTS = 100;

// --- ToS: page link patterns (from wearetosed content.js) ---
const TOS_PATHS = [
  '/privacy', '/privacy-policy', '/privacypolicy', '/privacy.html',
  '/terms', '/terms-of-service', '/termsofservice', '/tos', '/terms.html',
  '/legal', '/legal/privacy', '/legal/terms',
  '/cookie-policy', '/cookies',
  '/policies/privacy', '/policies/privacy-policy', '/policies/terms',
  '/about/privacy', '/about/terms',
  '/help/privacy', '/site/privacy',
];

// =============================================================================
// Network monitoring (from wearebaked v0.5.1)
// =============================================================================

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    // Tab navigation: reset network data for tab
    if (details.type === 'main_frame') {
      if (!tabData[details.tabId]) tabData[details.tabId] = {};
      tabData[details.tabId].networkData = {
        requestCount: 0,
        thirdPartyDomains: {},
        categories: {},
        brokers: {},
        bytesReceived: 0,
        bytesSent: 0,
      };
    }

    // Record timing
    networkTraffic.timing[details.requestId] = Date.now();

    // Init redirect chain
    networkTraffic.redirects[details.requestId] = [details.url];

    // Track request body size
    if (details.requestBody) {
      const domain = extractDomain(details.url);
      if (domain && networkTraffic.domains[domain]) {
        let size = 0;
        if (details.requestBody.raw) {
          for (const part of details.requestBody.raw) {
            if (part.bytes) size += part.bytes.byteLength;
          }
        }
        networkTraffic.domains[domain].bytesSent += size;
        // Also track per-tab
        const tabNet = tabData[details.tabId]?.networkData;
        if (tabNet) tabNet.bytesSent += size;
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (networkTraffic.redirects[details.requestId]) {
      networkTraffic.redirects[details.requestId].push(details.redirectUrl);
    }
  },
  { urls: ['<all_urls>'] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const domain = extractDomain(details.url);
    if (!domain) return;

    const tabDomain = tabData[details.tabId]?.domain || '';
    const thirdParty = isThirdParty(domain, tabDomain);

    // Response time
    let responseTime = 0;
    if (networkTraffic.timing[details.requestId]) {
      responseTime = Date.now() - networkTraffic.timing[details.requestId];
      delete networkTraffic.timing[details.requestId];
    }

    // Finalize redirect chains
    const chain = networkTraffic.redirects[details.requestId];
    if (chain && chain.length > 1) {
      const lastInChain = chain[chain.length - 1];
      if (lastInChain !== details.url) chain.push(details.url);
      const originDomain = extractDomain(chain[0]);
      if (!networkTraffic.finalRedirects[originDomain]) networkTraffic.finalRedirects[originDomain] = [];
      if (networkTraffic.finalRedirects[originDomain].length < MAX_FINAL_REDIRECTS) {
        networkTraffic.finalRedirects[originDomain].push(chain);
      }
    }
    delete networkTraffic.redirects[details.requestId];

    // Classify domain
    const classification = classifyNetworkDomain(domain, details);

    // Bytes received
    let bytesReceived = 0;
    const cl = getHeader(details.responseHeaders, 'content-length');
    if (cl) bytesReceived = parseInt(cl, 10) || 0;

    // Update global domain stats
    if (!networkTraffic.domains[domain]) {
      networkTraffic.domains[domain] = {
        count: 0, classification, thirdPartyOn: {},
        bytesReceived: 0, bytesSent: 0,
      };
    }
    const d = networkTraffic.domains[domain];
    d.count++;
    if (thirdParty && tabDomain) d.thirdPartyOn[tabDomain] = true;
    d.bytesReceived += bytesReceived;

    // Update per-tab network data
    const tabNet = tabData[details.tabId]?.networkData;
    if (tabNet) {
      tabNet.requestCount++;
      tabNet.bytesReceived += bytesReceived;
      if (thirdParty) {
        tabNet.thirdPartyDomains[domain] = {
          count: (tabNet.thirdPartyDomains[domain]?.count || 0) + 1,
          category: classification.category,
          risky: classification.risky,
          brokerName: classification.brokerName,
          brokerType: classification.brokerType,
          brokerDesc: classification.brokerDesc,
          bytesReceived: (tabNet.thirdPartyDomains[domain]?.bytesReceived || 0) + bytesReceived,
        };
        // Track categories
        tabNet.categories[classification.category] = (tabNet.categories[classification.category] || 0) + 1;
        // Track brokers
        if (classification.brokerName) {
          tabNet.brokers[classification.brokerName] = {
            domain,
            name: classification.brokerName,
            type: classification.brokerType,
            desc: classification.brokerDesc,
            count: (tabNet.brokers[classification.brokerName]?.count || 0) + 1,
          };
        }
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    delete networkTraffic.timing[details.requestId];
    delete networkTraffic.redirects[details.requestId];
  },
  { urls: ['<all_urls>'] }
);

// =============================================================================
// Message handler
// =============================================================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'scanResult' && sender.tab) {
    const tabId = sender.tab.id;
    if (!tabData[tabId]) tabData[tabId] = {};
    tabData[tabId].domain = msg.domain;
    tabData[tabId].url = msg.url;
    tabData[tabId].scan = msg.data;
    tabData[tabId].scanTime = Date.now();
    updateBadge(tabId);

    // Kick off cookie + ToS fetch if not done yet
    if (!tabData[tabId].cookies) fetchCookies(tabId, msg.url, msg.domain);
    if (!tabData[tabId].tos && !tabData[tabId].tosFetching) {
      if (domainTosCache[msg.domain]) {
        tabData[tabId].tos = domainTosCache[msg.domain];
        updateBadge(tabId);
      } else {
        const tosLinks = msg.data?.tosLinks || [];
        fetchToS(tabId, msg.url, msg.domain, tosLinks);
      }
    }
  }

  if (msg.type === 'getReport') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return sendResponse(null);
      const data = tabData[tabs[0].id];
      if (!data) return sendResponse(null);
      sendResponse(buildReport(data));
    });
    return true;
  }

  if (msg.type === 'getFullReport') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) return sendResponse(null);
      const tabId = tabs[0].id;
      const data = tabData[tabId];
      if (!data) return sendResponse(null);

      const report = buildReport(data);

      // Add raw cookies for dashboard cookie table
      try {
        report.rawCookies = await chrome.cookies.getAll({ url: data.url });
      } catch { report.rawCookies = []; }

      // Add network data for dashboard
      const tabNet = data.networkData || {};
      // Collect redirect chains relevant to this tab's domain
      const redirectChains = [];
      for (const [origin, chains] of Object.entries(networkTraffic.finalRedirects)) {
        for (const chain of chains) {
          redirectChains.push({ origin, chain });
        }
      }

      report.network = {
        domains: tabNet.thirdPartyDomains || {},
        totalRequests: tabNet.requestCount || 0,
        thirdPartyCount: Object.keys(tabNet.thirdPartyDomains || {}).length,
        brokers: Object.values(tabNet.brokers || {}),
        categories: tabNet.categories || {},
        redirectChains: redirectChains.slice(-30),
      };

      sendResponse(report);
    });
    return true;
  }

  if (msg.type === 'cleanCookies') {
    (async () => {
      try {
        const cookies = await chrome.cookies.getAll({ url: msg.url });
        let deleted = 0;
        const domain = new URL(msg.url).hostname;
        for (const c of cookies) {
          if (msg.mode === 'all' || (msg.mode === 'thirdParty' &&
              !c.domain.includes(domain) && !domain.includes(c.domain.replace(/^\./, '')))) {
            const protocol = c.secure ? 'https' : 'http';
            const cookieUrl = `${protocol}://${c.domain.replace(/^\./, '')}${c.path}`;
            try {
              await chrome.cookies.remove({ url: cookieUrl, name: c.name });
              deleted++;
            } catch {}
          }
        }
        // Re-fetch cookies for tab
        const tabId = Object.keys(tabData).find(id => tabData[id]?.url === msg.url);
        if (tabId) {
          delete tabData[tabId].cookies;
          fetchCookies(parseInt(tabId), msg.url, tabData[tabId].domain);
        }
        sendResponse({ deleted });
      } catch { sendResponse({ deleted: 0 }); }
    })();
    return true;
  }

  return false;
});

// --- Cookie fetching ---
async function fetchCookies(tabId, url, domain) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!tabData[tabId]) return;

    const firstParty = cookies.filter(c =>
      c.domain.includes(domain) || domain.includes(c.domain.replace(/^\./, ''))
    );
    const thirdParty = cookies.filter(c =>
      !c.domain.includes(domain) && !domain.includes(c.domain.replace(/^\./, ''))
    );

    let longestDays = 0;
    const now = Date.now() / 1000;
    for (const c of cookies) {
      if (c.expirationDate) {
        const days = Math.round((c.expirationDate - now) / 86400);
        if (days > longestDays) longestDays = days;
      }
    }

    tabData[tabId].cookies = {
      total: cookies.length,
      firstParty: firstParty.length,
      thirdParty: thirdParty.length,
      thirdPartyDomains: [...new Set(thirdParty.map(c => c.domain.replace(/^\./, '')))].slice(0, 15),
      session: cookies.filter(c => c.session).length,
      persistent: cookies.filter(c => !c.session).length,
      longestDays,
    };
    updateBadge(tabId);
  } catch {}
}

// --- ToS fetching (uses wearetosed's scanText via tos-scanner.js) ---

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function tryFetchAndScan(url) {
  try {
    const resp = await fetch(url, {
      redirect: 'follow',
      credentials: 'include',
      signal: AbortSignal.timeout(8000),
      headers: { 'Accept': 'text/html,application/xhtml+xml' },
    });
    if (!resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain')) return null;

    let html = await resp.text();

    // Follow meta refresh redirects (Google pattern)
    const metaRedirect = html.match(/content=["'][^"']*URL=([^"'\s>]+)/i);
    if (metaRedirect && htmlToText(html).length < 500) {
      const r2 = await fetch(metaRedirect[1], { redirect: 'follow', credentials: 'include', signal: AbortSignal.timeout(8000) });
      if (r2.ok) html = await r2.text();
    }

    const text = htmlToText(html);
    if (text.length < 100) return null;
    return scanText(text);
  } catch { return null; }
}

async function fetchToS(tabId, pageUrl, domain, pageLinks = []) {
  if (!tabData[tabId]) return;
  tabData[tabId].tosFetching = true;

  const origin = new URL(pageUrl).origin;

  const pathUrls = TOS_PATHS.map(p => origin + p);
  const allUrls = [...pathUrls, ...pageLinks];
  const seen = new Set();
  const uniqueUrls = allUrls.filter(u => {
    const key = u.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  let privacyResult = null;
  let termsResult = null;

  for (const url of uniqueUrls) {
    if (privacyResult && termsResult) break;

    const urlLower = url.toLowerCase();
    const isPrivacy = /privac|cookie|data.?polic|gdpr|ccpa/i.test(urlLower);
    const isTerms = /terms|tos$|legal(?!.*privac)|eula|conditions/i.test(urlLower);

    if (isPrivacy && privacyResult) continue;
    if (isTerms && !isPrivacy && termsResult) continue;

    const result = await tryFetchAndScan(url);
    if (!result) continue;

    if (isPrivacy && !privacyResult) privacyResult = result;
    else if (isTerms && !termsResult) termsResult = result;
    else if (!privacyResult) privacyResult = result;
  }

  // Fallback: ask content script to fetch (SPA pages like Reddit)
  if (!privacyResult && !termsResult && tabData[tabId]) {
    const tosLinksFromPage = tabData[tabId].scan?.tosLinks || pageLinks;
    if (tosLinksFromPage.length > 0) {
      try {
        const response = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, { type: 'fetchToS', urls: tosLinksFromPage.slice(0, 5) }, (r) => {
            resolve(r);
          });
        });
        if (response?.text) {
          const result = scanText(response.text);
          if (result) {
            const urlLower = (response.url || '').toLowerCase();
            if (/privac|cookie|data.?polic/i.test(urlLower)) privacyResult = result;
            else termsResult = result;
          }
        }
      } catch {}
    }
  }

  if (!tabData[tabId]) return;

  // Combine scores
  const pScore = privacyResult ? privacyResult.score : 0;
  const tScore = termsResult ? termsResult.score : 0;
  let combined;
  if (privacyResult && termsResult) combined = Math.min(100, Math.round((pScore + tScore) / 2));
  else if (privacyResult) combined = pScore;
  else if (termsResult) combined = tScore;
  else combined = 0;

  const found = !!(privacyResult || termsResult);

  const CASUAL_LABELS = {
    'data-sharing': 'They can share or sell your data',
    'surveillance': 'They track and profile you',
    'retention': 'They may keep your data forever',
    'law-enforcement': 'They hand data to authorities',
    'rights-erosion': 'You give up legal rights',
    'unilateral-control': 'They can change rules anytime',
  };

  const flagged = [];
  const allItems = [...(privacyResult?.items || []), ...(termsResult?.items || [])];
  const seenPatterns = new Set();
  for (const item of allItems) {
    if (seenPatterns.has(item.pattern)) continue;
    seenPatterns.add(item.pattern);
    flagged.push({ type: item.pattern, label: CASUAL_LABELS[item.pattern] || item.pattern, count: item.count });
  }

  const tosResult = { found, score: combined, flagged };
  tabData[tabId].tos = tosResult;
  tabData[tabId].tosFetching = false;
  domainTosCache[domain] = tosResult;
  updateBadge(tabId);
}

// --- Badge ---
function updateBadge(tabId) {
  const data = tabData[tabId];
  if (!data) return;

  const report = buildReport(data);
  const score = report?.verdict?.score || 0;

  let color;
  if (score <= 15) color = '#2ecc71';
  else if (score <= 40) color = '#e67e22';
  else color = '#e74c3c';

  chrome.action.setBadgeText({ tabId, text: String(score) });
  chrome.action.setBadgeBackgroundColor({ tabId, color });
}

// --- Report builder ---
function buildReport(data) {
  if (!data) return null;

  const scan = data.scan || {};
  const cookies = data.cookies || { total: 0, firstParty: 0, thirdParty: 0, thirdPartyDomains: [], session: 0, persistent: 0, longestDays: 0 };
  const tos = data.tos || null;

  // Fingerprinting
  const fpCalls = scan.fingerprinting || [];
  const byCat = {};
  for (const call of fpCalls) {
    if (!byCat[call.category]) byCat[call.category] = { count: 0, apis: new Set() };
    byCat[call.category].count++;
    byCat[call.category].apis.add(call.api);
  }
  const fpMethods = Object.entries(byCat).map(([technique, d]) => ({
    technique, apis: [...d.apis], calls: d.count,
  }));

  // Beacons
  const beacons = scan.beacons || [];

  // Trackers
  const trackers = scan.trackers || {};
  const trackerTotal = (trackers.pixels || 0) + beacons.length + (trackers.hiddenIframes || 0);
  const trackerCompanies = [...(trackers.companies || [])];

  for (const b of beacons) {
    try {
      const domain = new URL(b.url).hostname;
      const existing = trackerCompanies.find(c => domain.includes(c.name?.toLowerCase?.()));
      if (!existing) trackerCompanies.push({ name: domain, purpose: 'Analytics', count: 1 });
    } catch {}
  }

  const scriptCompanies = scan.thirdPartyScripts?.companies || [];

  // Storage
  const storage = scan.storage || { totalKeys: 0, flaggedCount: 0, byCategory: {}, flaggedKeys: [] };

  // Links
  const links = scan.links || { total: 0, withTracking: 0, redirectWrappers: 0, details: [] };
  const linkPct = links.total > 0 ? Math.round((links.withTracking / links.total) * 100) : 0;

  // Dark patterns
  const dp = scan.darkPatterns || { score: 0, detected: [] };

  // Forms (from wearesilent)
  const formFields = scan.formFields || [];

  // Network (from wearebaked) — per-tab data
  const tabNet = data.networkData || {};
  const brokerCount = Object.keys(tabNet.brokers || {}).length;

  const report = {
    site: data.domain,
    url: data.url,
    cookies: {
      total: cookies.total, firstParty: cookies.firstParty, thirdParty: cookies.thirdParty,
      thirdPartyDomains: cookies.thirdPartyDomains, longestDays: cookies.longestDays,
    },
    trackers: {
      pixels: trackers.pixels || 0, beacons: beacons.length, hiddenIframes: trackers.hiddenIframes || 0,
      thirdPartyScripts: scan.thirdPartyScripts?.total || 0,
      companies: trackerCompanies, scriptCompanies, total: trackerTotal,
    },
    fingerprinting: { techniques: fpMethods.length, totalCalls: fpCalls.length, methods: fpMethods },
    pressure: {
      score: dp.score,
      tactics: (dp.detected || []).map(d => {
        const labels = {
          confirm_shaming: 'Guilt-trip language on decline buttons',
          fake_urgency: 'Fake urgency or scarcity claims',
          countdown_timer: 'Countdown timer creating pressure',
          pre_checked_boxes: 'Pre-checked boxes opting you in',
          hidden_unsubscribe: 'Opt-out text made hard to find',
        };
        return { tactic: labels[d.type] || d.type, type: d.type, evidence: d.matches?.slice(0, 2) || [] };
      }),
    },
    tos: tos ? (tos.found ? { score: tos.score, flagged: tos.flagged } : { found: false }) : { loading: true },
    localData: {
      totalKeys: storage.totalKeys || 0, suspicious: storage.flaggedCount || 0,
      byCategory: storage.byCategory || {}, flaggedKeys: storage.flaggedKeys || [],
    },
    linkTracking: {
      total: links.total, tracked: links.withTracking,
      redirectWrappers: links.redirectWrappers, percentage: linkPct,
    },
    forms: {
      fieldCount: formFields.length,
      fields: formFields.slice(0, 15),
      trackersWhileTyping: formFields.length > 0 ? trackerCompanies.length + scriptCompanies.length : 0,
      trackerNames: formFields.length > 0
        ? [...new Set([...trackerCompanies, ...scriptCompanies].map(c => c.name))].slice(0, 5)
        : [],
    },
  };

  report.verdict = computeVerdict(report);
  return report;
}

function computeVerdict(r) {
  let score = 0;
  const concerns = [];

  if (r.cookies.thirdParty > 10) { score += 20; concerns.push('Heavy cross-site cookie tracking'); }
  else if (r.cookies.thirdParty > 3) { score += 10; concerns.push('Third-party cookies tracking you'); }
  if (r.cookies.longestDays > 365) { score += 5; concerns.push('Cookies last over a year'); }

  if (r.trackers.total > 10) { score += 25; concerns.push('Heavy hidden tracking'); }
  else if (r.trackers.total > 3) { score += 15; concerns.push('Hidden trackers on this page'); }
  if (r.trackers.thirdPartyScripts > 15) { score += 10; concerns.push('Lots of outside scripts loaded'); }

  if (r.fingerprinting.techniques >= 3) { score += 25; concerns.push('Aggressively fingerprinting your device'); }
  else if (r.fingerprinting.techniques >= 1) { score += 10; concerns.push('Reading your device info'); }

  if (r.pressure.score >= 60) { score += 15; concerns.push('Using manipulative design tricks'); }
  else if (r.pressure.score >= 20) { score += 5; concerns.push('Some pressure tactics'); }

  if (r.tos?.score >= 60) { score += 10; concerns.push('Toxic terms of service'); }
  else if (r.tos?.score >= 30) { score += 5; concerns.push('Concerning terms'); }

  if (r.localData.suspicious > 5) { score += 5; concerns.push('Tracking IDs saved on your device'); }

  if (r.linkTracking.percentage > 50) { score += 5; concerns.push('Most links tag your clicks'); }

  // Network — data brokers (from wearebaked)
  const brokerCount = r.forms?.trackersWhileTyping || 0; // approximate from tracker companies
  // Use actual network broker data if available in full report
  // For popup this is approximate; dashboard has full data

  // Forms (from wearesilent)
  if (r.forms?.fieldCount > 0 && r.forms?.trackersWhileTyping > 3) {
    score += 10; concerns.push('Trackers watching while you fill out forms');
  }

  score = Math.min(score, 100);

  let risk, recommendation;
  if (score <= 15) { risk = 'low'; recommendation = 'This site is fairly clean. Browse normally.'; }
  else if (score <= 40) { risk = 'moderate'; recommendation = 'Typical tracking. Private browsing or clearing cookies helps.'; }
  else if (score <= 70) { risk = 'high'; recommendation = 'Significant privacy risks. Avoid sharing personal info here.'; }
  else { risk = 'critical'; recommendation = 'Very invasive. Use tracker blocking or avoid this site.'; }

  return { score, risk, recommendation, concerns };
}

// --- Tab cleanup ---
chrome.tabs.onRemoved.addListener((tabId) => { delete tabData[tabId]; });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    const oldDomain = tabData[tabId]?.domain;
    try {
      const newDomain = new URL(changeInfo.url).hostname;
      if (oldDomain && oldDomain !== newDomain) {
        delete tabData[tabId];
      }
    } catch {
      delete tabData[tabId];
    }
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (tabData[tabId]) updateBadge(tabId);
});
