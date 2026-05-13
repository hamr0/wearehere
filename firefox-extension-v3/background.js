/**
 * background.js — v3.1.1 aggregator background script (Firefox MV2).
 * Routes per-module detection messages into unified per-tab state.
 * Handles: network monitoring, cookie analysis, ToS cache/fetch, verdict, badge.
 *
 * tos-scanner.js and network-domains.js are loaded via manifest background.scripts.
 */

// --- Per-tab state ---
const tabData = {};
const domainTosCache = {};
let dashboardTabId = null;

// --- Network traffic state (from wearebaked v0.5.1) ---
const networkTraffic = {
  domains: {},
  timing: {},
  redirects: {},
  finalRedirects: {},
};
const MAX_FINAL_REDIRECTS = 100;

// =============================================================================
// Per-tab data structure
// =============================================================================
function ensureTab(tabId) {
  if (!tabData[tabId]) {
    tabData[tabId] = {
      url: '',
      domain: '',
      modules: {
        watched: null,
        cooked: null,
        played: null,
        leaked: null,
        linked: null,
        tosed: null,
        silent: null,
      },
      networkData: null,
      cookies: null,
    };
  }
  return tabData[tabId];
}

// =============================================================================
// Network monitoring (from wearebaked v0.5.1)
// =============================================================================
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    if (details.type === 'main_frame') {
      const tab = ensureTab(details.tabId);
      try {
        const mainUrl = new URL(details.url);
        tab.domain = mainUrl.hostname;
        tab.url = details.url;
      } catch {}
      tab.networkData = {
        requestCount: 0,
        thirdPartyDomains: {},
        categories: {},
        brokers: {},
        bytesReceived: 0,
        bytesSent: 0,
      };
    }

    // Early domain classification for Firefox ETP (may block before completion)
    if (details.tabId >= 0 && details.type !== 'main_frame') {
      const domain = extractDomain(details.url);
      if (domain) ensureDomainEntry(domain, details.tabId);
    }

    networkTraffic.timing[details.requestId] = Date.now();
    networkTraffic.redirects[details.requestId] = [details.url];

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
        const tabNet = tabData[details.tabId]?.networkData;
        if (tabNet) tabNet.bytesSent += size;
      }
    }
  },
  { urls: ['<all_urls>'] },
  ['requestBody']
);

browser.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.tabId < 0) return;
    if (networkTraffic.redirects[details.requestId]) {
      networkTraffic.redirects[details.requestId].push(details.redirectUrl);
    }
  },
  { urls: ['<all_urls>'] }
);

browser.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0) return;

    const domain = extractDomain(details.url);
    if (!domain) return;

    const tabDomain = tabData[details.tabId]?.domain || '';
    const thirdParty = isThirdParty(domain, tabDomain);

    let responseTime = 0;
    if (networkTraffic.timing[details.requestId]) {
      responseTime = Date.now() - networkTraffic.timing[details.requestId];
      delete networkTraffic.timing[details.requestId];
    }

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

    const classification = classifyNetworkDomain(domain, details);

    let bytesReceived = 0;
    const cl = getHeader(details.responseHeaders, 'content-length');
    if (cl) bytesReceived = parseInt(cl, 10) || 0;

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
        tabNet.categories[classification.category] = (tabNet.categories[classification.category] || 0) + 1;
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

browser.webRequest.onErrorOccurred.addListener(
  (details) => {
    // Firefox ETP may block requests before completion — classify early
    if (details.tabId >= 0 && details.type !== 'main_frame') {
      const domain = extractDomain(details.url);
      if (domain) ensureDomainEntry(domain, details.tabId);
    }
    delete networkTraffic.timing[details.requestId];
    delete networkTraffic.redirects[details.requestId];
  },
  { urls: ['<all_urls>'] }
);

// Helper: ensure a domain entry exists for ETP-blocked requests
function ensureDomainEntry(domain, tabId) {
  const tabDomain = tabData[tabId]?.domain || '';
  const thirdParty = isThirdParty(domain, tabDomain);
  if (!thirdParty) return;

  const classification = classifyNetworkDomain(domain, {});

  if (!networkTraffic.domains[domain]) {
    networkTraffic.domains[domain] = {
      count: 0, classification, thirdPartyOn: {},
      bytesReceived: 0, bytesSent: 0,
    };
  }
  const d = networkTraffic.domains[domain];
  if (tabDomain) d.thirdPartyOn[tabDomain] = true;

  const tabNet = tabData[tabId]?.networkData;
  if (tabNet && !tabNet.thirdPartyDomains[domain]) {
    tabNet.thirdPartyDomains[domain] = {
      count: 1,
      category: classification.category,
      risky: classification.risky,
      brokerName: classification.brokerName,
      brokerType: classification.brokerType,
      brokerDesc: classification.brokerDesc,
      bytesReceived: 0,
    };
    tabNet.categories[classification.category] = (tabNet.categories[classification.category] || 0) + 1;
    if (classification.brokerName) {
      tabNet.brokers[classification.brokerName] = {
        domain,
        name: classification.brokerName,
        type: classification.brokerType,
        desc: classification.brokerDesc,
        count: 1,
      };
    }
  }
}

// =============================================================================
// Message handler
// =============================================================================
browser.runtime.onMessage.addListener((msg, sender) => {

  // --- Per-module detection messages from content scripts ---
  if (msg.type === 'detection' && sender.tab) {
    const tabId = sender.tab.id;
    const tab = ensureTab(tabId);
    const mod = msg.module;
    const data = msg.data;

    // Set domain/url from detection or sender tab
    if (data.domain) tab.domain = data.domain;
    if (data.url) tab.url = data.url;
    if (!tab.url && sender.tab.url) tab.url = sender.tab.url;
    if (!tab.domain && sender.tab.url) {
      try { tab.domain = new URL(sender.tab.url).hostname; } catch {}
    }

    // Route to per-module storage
    if (mod === 'watched') {
      tab.modules.watched = data;
    } else if (mod === 'cooked') {
      tab.modules.cooked = data;
    } else if (mod === 'played') {
      tab.modules.played = data;
    } else if (mod === 'leaked') {
      tab.modules.leaked = data;
    } else if (mod === 'linked') {
      tab.modules.linked = data;
    } else if (mod === 'tosed') {
      handleTosedDetection(tabId, tab, data);
    } else if (mod === 'silent') {
      // Merge/deduplicate fields from iframes
      if (!tab.modules.silent) {
        tab.modules.silent = { fields: [] };
      }
      const existing = tab.modules.silent.fields;
      const seen = {};
      for (let i = 0; i < existing.length; i++) seen[existing[i]] = true;
      const newFields = data.fields || [];
      for (let i = 0; i < newFields.length; i++) {
        if (!seen[newFields[i]]) {
          existing.push(newFields[i]);
          seen[newFields[i]] = true;
        }
      }
    }

    // Kick off cookie fetch if not done
    if (!tab.cookies && tab.url) {
      fetchCookies(tabId, tab.url, tab.domain);
    }

    updateBadge(tabId);
    return Promise.resolve();
  }

  // --- ToS: checkCache from detect-tosed.js ---
  if (msg.type === 'checkCache' && sender.tab) {
    const domain = msg.domain;
    const cached = domainTosCache[domain] || null;
    if (cached && cached.privacy && cached.terms) {
      const tabId = sender.tab.id;
      const tab = ensureTab(tabId);
      tab.modules.tosed = buildTosModuleData(domain, cached.privacy, cached.terms);
      updateBadge(tabId);
    }
    return Promise.resolve(cached);
  }

  // --- ToS: bgFetch from detect-tosed.js ---
  if (msg.type === 'bgFetch') {
    const url = msg.url;
    return fetch(url, { redirect: 'follow' })
      .then(resp => {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.text();
      })
      .then(html => {
        const metaRedirect = html.match(/content=["'][^"']*URL=([^"'\s>]+)/i);
        if (metaRedirect && html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 500) {
          return fetch(metaRedirect[1], { redirect: 'follow' })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
        }
        return html;
      })
      .then(html => {
        const text = html
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
        if (text.length < 200) throw new Error('Too short');
        return scanText(text);
      })
      .catch(() => null);
  }

  // --- Popup: getReport ---
  if (msg.type === 'getReport') {
    return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (!tabs[0]) return null;
      const data = tabData[tabs[0].id];
      if (!data) return null;
      return buildReport(data);
    });
  }

  // --- Dashboard: getFullReport ---
  if (msg.type === 'getFullReport') {
    const targetTabId = msg.tabId || null;

    const resolve = async (tabId) => {
      const data = tabData[tabId];
      if (!data) return null;

      const report = buildReport(data);

      // Cookies: global scan (all cookies, not filtered to this tab)
      try {
        report.rawCookies = await browser.cookies.getAll({});
      } catch { report.rawCookies = []; }

      const tabNet = data.networkData || {};
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

      // Build networkDashboard (wearebaked-style data for Network tab)
      try {
        const globalDomains = {};
        for (const [domain, info] of Object.entries(networkTraffic.domains)) {
          globalDomains[domain] = {
            count: info.count,
            classification: info.classification || { category: 'unknown', risky: false },
            thirdPartyOn: Object.keys(info.thirdPartyOn || {}),
            bytesReceived: info.bytesReceived || 0,
            bytesSent: info.bytesSent || 0,
            types: info.types || {},
            beaconScore: info.beaconScore || 0,
            beaconInterval: info.beaconInterval || 0,
            beaconConfidence: info.beaconConfidence || 0,
            isNew: info.isNew || false,
            firstSeen: info.firstSeen || 0,
          };
        }

        let globalTotalRequests = 0;
        let globalThirdParty = 0;
        for (const d of Object.values(networkTraffic.domains)) {
          globalTotalRequests += d.count;
          if (Object.keys(d.thirdPartyOn || {}).length > 0) globalThirdParty += d.count;
        }

        report.networkDashboard = {
          totals: { count: globalTotalRequests, thirdParty: globalThirdParty },
          domains: globalDomains,
          tabs: buildTabsData(),
          websockets: {},
          requests: [],
          redirectChains: redirectChains.slice(-30),
        };
      } catch (e) {
        console.error('Error building networkDashboard:', e);
        report.networkDashboard = { totals: { count: 0, thirdParty: 0 }, domains: {}, tabs: {}, websockets: {}, requests: [], redirectChains: [] };
      }

      return report;
    };

    if (targetTabId) {
      return resolve(targetTabId);
    } else {
      return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (!tabs[0]) return null;
        return resolve(tabs[0].id);
      });
    }
  }

  // --- Dashboard: getOpenTabs (for tab dropdown) ---
  if (msg.type === 'getOpenTabs') {
    const tabs = [];
    for (const [id, data] of Object.entries(tabData)) {
      if (data.domain) {
        tabs.push({ id: parseInt(id), domain: data.domain, url: data.url });
      }
    }
    return Promise.resolve(tabs);
  }

  // --- Dashboard: register tab ---
  if (msg.type === 'registerDashboard') {
    if (sender.tab) {
      dashboardTabId = sender.tab.id;
    } else if (sender.url && sender.url.includes('report.html')) {
      browser.tabs.query({}).then((tabs) => {
        const match = tabs.find(t => t.url && t.url.startsWith(browser.runtime.getURL('report.html')));
        if (match) dashboardTabId = match.id;
      });
    }
    return Promise.resolve();
  }

  // --- Dashboard: open or reuse single tab ---
  if (msg.type === 'openDashboard') {
    if (dashboardTabId) {
      return browser.tabs.get(dashboardTabId).then((tab) => {
        return { existingTabId: dashboardTabId };
      }).catch(() => {
        dashboardTabId = null;
        return { existingTabId: null };
      });
    } else {
      return Promise.resolve({ existingTabId: null });
    }
  }

  // --- Cookie cleaning ---
  if (msg.type === 'cleanCookies') {
    return (async () => {
      try {
        let deleted = 0;
        if (msg.mode === 'list' && msg.cookies) {
          for (const c of msg.cookies) {
            const cDomain = c.domain.replace(/^\./, '');
            const protocol = c.secure ? 'https' : 'http';
            const cookieUrl = `${protocol}://${cDomain}${c.path}`;
            try {
              await browser.cookies.remove({ url: cookieUrl, name: c.name });
              deleted++;
            } catch {}
          }
        } else {
          const domain = new URL(msg.url).hostname;
          const cookies = await browser.cookies.getAll({ url: msg.url });
          for (const c of cookies) {
            const cDomain = c.domain.replace(/^\./, '');
            const protocol = c.secure ? 'https' : 'http';
            const cookieUrl = `${protocol}://${cDomain}${c.path}`;
            try {
              await browser.cookies.remove({ url: cookieUrl, name: c.name });
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
        return { deleted };
      } catch { return { deleted: 0 }; }
    })();
  }

  return false;
});

// =============================================================================
// ToS detection handler
// =============================================================================
function handleTosedDetection(tabId, tab, data) {
  if (data.subtype === 'directScan') {
    const scanResult = { items: data.items, score: data.score, total: data.total };
    const cached = domainTosCache[data.domain] || {};

    const privacyResult = data.pageType === 'privacy' ? scanResult : (cached.privacy || null);
    const termsResult = data.pageType === 'terms' ? scanResult : (cached.terms || null);

    tab.modules.tosed = buildTosModuleData(data.domain, privacyResult, termsResult);

    domainTosCache[data.domain] = {
      privacy: privacyResult,
      terms: termsResult,
    };
  } else if (data.subtype === 'fetchedResults') {
    tab.modules.tosed = buildTosModuleData(data.domain, data.privacy, data.terms);

    domainTosCache[data.domain] = {
      privacy: data.privacy,
      terms: data.terms,
    };
  }
}

function buildTosModuleData(domain, privacyResult, termsResult) {
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

  return {
    found, score: combined, flagged, domain,
    privacy: privacyResult ? { score: pScore, items: privacyResult.items || [] } : null,
    terms: termsResult ? { score: tScore, items: termsResult.items || [] } : null,
  };
}

// =============================================================================
// Cookie fetching
// =============================================================================
async function fetchCookies(tabId, url, domain) {
  try {
    const cookies = await browser.cookies.getAll({ url });
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

    // OCD-based classification: distinguish snoops (Analytics+Marketing) from
    // essential (1st-party non-snoop) and embeds (3rd-party non-snoop). Snoops can be
    // first-party (e.g. Google's __Secure-1PSID family on google.com), which is why
    // we can't infer this from the thirdParty count alone.
    const isFirstParty = (c) =>
      c.domain.includes(domain) || domain.includes(c.domain.replace(/^\./, ''));
    let snoops = 0, embeds = 0, essential = 0;
    const vendorMap = {};
    for (const c of cookies) {
      const ocd = classifyCookie(c.name);
      if (ocd && isTrackerCategory(ocd.category)) {
        snoops++;
        const v = ocd.vendor || 'Unknown';
        if (!vendorMap[v]) vendorMap[v] = { analytics: 0, marketing: 0 };
        if (ocd.category === 'Marketing') vendorMap[v].marketing++;
        else vendorMap[v].analytics++;
      } else if (isFirstParty(c)) {
        essential++;
      } else {
        embeds++;
      }
    }
    const snoopVendors = Object.entries(vendorMap)
      .map(([name, c]) => ({
        name,
        count: c.analytics + c.marketing,
        purpose: c.marketing >= c.analytics ? 'Advertising' : 'Analytics',
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    tabData[tabId].cookies = {
      total: cookies.length,
      firstParty: firstParty.length,
      thirdParty: thirdParty.length,
      thirdPartyDomains: [...new Set(thirdParty.map(c => c.domain.replace(/^\./, '')))].slice(0, 15),
      session: cookies.filter(c => c.session).length,
      persistent: cookies.filter(c => !c.session).length,
      longestDays,
      snoops, embeds, essential, snoopVendors,
    };
    updateBadge(tabId);
  } catch {}
}

// =============================================================================
// Build tabs data for networkDashboard (wearebaked format)
// =============================================================================
function buildTabsData() {
  const result = {};
  for (const [id, data] of Object.entries(tabData)) {
    if (data.domain) {
      const net = data.networkData || {};
      result[id] = {
        domain: data.domain,
        requests: net.requestCount || 0,
        thirdParties: Object.keys(net.thirdPartyDomains || {}),
      };
    }
  }
  return result;
}

// =============================================================================
// Report builder — translates per-module data to unified format
// =============================================================================
function buildReport(data) {
  if (!data) return null;

  const m = data.modules;
  const cookies = data.cookies || { total: 0, firstParty: 0, thirdParty: 0, thirdPartyDomains: [], session: 0, persistent: 0, longestDays: 0, snoops: 0, embeds: 0, essential: 0, snoopVendors: [] };

  // --- Fingerprinting (from watched module) ---
  const watched = m.watched || { items: [], totals: { fingerprint: 0, permission: 0, total: 0 } };
  const fpItems = watched.items || [];
  const byCat = {};
  for (const call of fpItems) {
    if (!byCat[call.category]) byCat[call.category] = { count: 0, apis: new Set() };
    byCat[call.category].count += call.count;
    byCat[call.category].apis.add(call.api);
  }
  const fpMethods = Object.entries(byCat).map(([technique, d]) => ({
    technique, apis: [...d.apis], calls: d.count,
  }));

  // --- Trackers (from cooked module + cookie-snoop vendors) ---
  const cooked = m.cooked || { items: [], totals: { pixels: 0, iframes: 0, beacons: 0, prefetches: 0, total: 0 } };
  const cookedItems = cooked.items || [];
  const trackerCompanies = {};
  for (const item of cookedItems) {
    const name = item.company || item.domain;
    if (!trackerCompanies[name]) trackerCompanies[name] = { name, purpose: item.purpose || 'Unknown', count: 0, viaPixels: 0, viaCookies: 0 };
    trackerCompanies[name].count++;
    trackerCompanies[name].viaPixels++;
  }
  // Merge cookie-snoop vendors so "Who's tracking you" surfaces first-party tracker cookies too.
  for (const sv of (cookies.snoopVendors || [])) {
    if (!trackerCompanies[sv.name]) {
      trackerCompanies[sv.name] = { name: sv.name, purpose: sv.purpose, count: 0, viaPixels: 0, viaCookies: 0 };
    }
    trackerCompanies[sv.name].count += sv.count;
    trackerCompanies[sv.name].viaCookies += sv.count;
  }
  const companies = Object.values(trackerCompanies).sort((a, b) => b.count - a.count).slice(0, 20);
  const trackerTotal = (cooked.totals?.pixels || 0) + (cooked.totals?.beacons || 0) + (cooked.totals?.iframes || 0);

  // --- Dark patterns (from played module) ---
  const played = m.played || { items: [], score: 0, total: 0 };
  const dpTactics = [];
  const PLAYED_LABELS = {
    countdown: 'Countdown timer creating pressure',
    discount: 'Discount pressure badges',
    scarcity: 'Fake scarcity or social proof claims',
    prechecked: 'Pre-checked boxes opting you in',
    shaming: 'Guilt-trip language on decline buttons',
    'hidden-unsub': 'Opt-out text made hard to find',
  };
  for (const item of (played.items || [])) {
    dpTactics.push({
      tactic: PLAYED_LABELS[item.pattern] || item.pattern,
      type: item.pattern,
      count: item.count || 0,
      evidence: [],
    });
  }

  // --- Storage (from leaked module) ---
  const leaked = m.leaked || { items: [], totals: { local: 0, session: 0, flagged: 0 } };
  const leakedItems = leaked.items || [];
  const flaggedItems = leakedItems.filter(i => i.flags && i.flags.length > 0);
  const byCategory = {};
  for (const item of flaggedItems) {
    for (const cat of item.flags) {
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(item.key);
    }
  }

  // --- Links (from linked module) ---
  const linked = m.linked || { items: [], totals: { wrappers: 0, tracked: 0, total: 0, allLinks: 0 } };
  const allLinksCount = linked.totals?.allLinks || linked.totals?.total || 0;
  const trackedCount = linked.totals?.tracked || 0;
  const linkPct = allLinksCount > 0 ? Math.round((trackedCount / allLinksCount) * 100) : 0;

  // --- Terms (from tosed module) ---
  const tosed = m.tosed || null;

  // --- Forms (from silent module) ---
  const silent = m.silent || { fields: [] };
  const formFields = silent.fields || [];

  // --- Third-party scripts (scan from cooked items) ---
  const scriptCompanies = [];
  const thirdPartyScriptCount = 0;

  const report = {
    site: data.domain,
    url: data.url,
    cookies: {
      total: cookies.total, firstParty: cookies.firstParty, thirdParty: cookies.thirdParty,
      thirdPartyDomains: cookies.thirdPartyDomains, longestDays: cookies.longestDays,
      snoops: cookies.snoops || 0, embeds: cookies.embeds || 0, essential: cookies.essential || 0,
      snoopVendors: cookies.snoopVendors || [],
    },
    trackers: {
      pixels: cooked.totals?.pixels || 0,
      beacons: cooked.totals?.beacons || 0,
      hiddenIframes: cooked.totals?.iframes || 0,
      thirdPartyScripts: thirdPartyScriptCount,
      companies, scriptCompanies,
      total: trackerTotal,
    },
    fingerprinting: {
      techniques: fpMethods.length,
      totalCalls: fpItems.reduce((sum, i) => sum + (i.count || 0), 0),
      methods: fpMethods,
      items: fpItems,
    },
    pressure: {
      score: played.score || 0,
      tactics: dpTactics,
    },
    tos: tosed ? (tosed.found ? { score: tosed.score || 0, flagged: tosed.flagged || [], found: true, privacy: tosed.privacy || null, terms: tosed.terms || null } : { found: false }) : { loading: true },
    localData: {
      totalKeys: leakedItems.length,
      suspicious: flaggedItems.length,
      byCategory,
      flaggedKeys: flaggedItems.slice(0, 10).map(i => ({ key: i.key, flags: i.flags })),
    },
    linkTracking: {
      total: allLinksCount,
      tracked: trackedCount,
      redirectWrappers: linked.totals?.wrappers || 0,
      percentage: linkPct,
      details: (linked.items || []).slice(0, 50),
    },
    forms: {
      fieldCount: formFields.length,
      fields: formFields.slice(0, 15),
      trackersWhileTyping: formFields.length > 0 ? companies.length + scriptCompanies.length : 0,
      trackerNames: formFields.length > 0
        ? [...new Set([...companies, ...scriptCompanies].map(c => c.name))].slice(0, 5)
        : [],
    },
    network: {
      totalRequests: data.networkData?.requestCount || 0,
      trackerDomains: Object.entries(data.networkData?.thirdPartyDomains || {}).filter(([, d]) => d.risky).length,
      thirdPartyDomains: Object.keys(data.networkData?.thirdPartyDomains || {}).length,
      brokerCount: Object.keys(data.networkData?.brokers || {}).length,
    },
  };

  report.verdict = computeVerdict(report);
  return report;
}

// =============================================================================
// Verdict scoring
// =============================================================================
function computeVerdict(r) {
  let score = 0;
  const concerns = [];

  // Cookies (max 15): snoops dominate (curated OCD tracker identification),
  // embeds is a soft modifier (3rd-party non-snoop), persistence is a tiebreaker.
  // Snoop-driven scoring catches first-party tracking (e.g. Google's *PSID family)
  // that the old thirdParty proxy missed entirely.
  let cookiePts = 0;
  const ck = r.cookies;
  if (ck.snoops >= 10) { cookiePts += 12; concerns.push('Aggressive ad-tracking via cookies'); }
  else if (ck.snoops >= 3) { cookiePts += 8; concerns.push('Multiple ad-trackers tracking you'); }
  else if (ck.snoops >= 1) { cookiePts += 3; concerns.push('Ad-tracker cookies set'); }
  if (ck.embeds >= 16) { cookiePts += 2; concerns.push('Heavy use of outside cookies'); }
  if (ck.longestDays > 730) { cookiePts += 2; concerns.push('Cookies persist for years'); }
  else if (ck.longestDays > 365) { cookiePts += 1; concerns.push('Cookies last over a year'); }
  score += Math.min(15, cookiePts);

  // Network (max 10)
  if (r.network?.trackerDomains > 10) { score += 10; concerns.push('Many tracker domains in network traffic'); }
  else if (r.network?.trackerDomains > 3) { score += 5; concerns.push('Tracker domains detected'); }

  // Trackers (max 20)
  if (r.trackers.total > 10) { score += 20; concerns.push('Heavy hidden tracking'); }
  else if (r.trackers.total > 3) { score += 10; concerns.push('Hidden trackers on this page'); }

  // Pressure (max 15)
  if (r.pressure.score >= 60) { score += 15; concerns.push('Using manipulative design tricks'); }
  else if (r.pressure.score >= 20) { score += 5; concerns.push('Some pressure tactics'); }

  // Selling data (max 10)
  if (r.network?.brokerCount > 5) { score += 10; concerns.push('Data brokers found in network traffic'); }
  else if (r.network?.brokerCount > 0) { score += 5; concerns.push('Data broker connections detected'); }

  // Profiling (max 20)
  if (r.fingerprinting.techniques >= 3) { score += 20; concerns.push('Aggressively fingerprinting your device'); }
  else if (r.fingerprinting.techniques >= 1) { score += 10; concerns.push('Reading your device info'); }

  // Stored data (max 5)
  if (r.localData.suspicious > 5) { score += 5; concerns.push('Tracking IDs saved on your device'); }

  // Watching (max 10)
  if (r.forms?.fieldCount > 0 && r.forms?.trackersWhileTyping > 3) {
    score += 10; concerns.push('Trackers watching while you fill out forms');
  }

  // Clicks (max 5)
  if (r.linkTracking.percentage > 50) { score += 5; concerns.push('Most links tag your clicks'); }

  // Terms (max 15)
  if (r.tos?.score >= 60) { score += 15; concerns.push('Toxic terms of service'); }
  else if (r.tos?.score >= 30) { score += 10; concerns.push('Concerning terms'); }
  else if (r.tos?.score >= 10) { score += 5; concerns.push('Some concerning terms'); }

  score = Math.min(score, 100);

  let risk, recommendation;
  if (score <= 15) { risk = 'low'; recommendation = 'This site is fairly clean. Browse normally.'; }
  else if (score <= 40) { risk = 'moderate'; recommendation = 'Typical tracking. Private browsing or clearing cookies helps.'; }
  else if (score <= 70) { risk = 'high'; recommendation = 'Significant privacy risks. Avoid sharing personal info here.'; }
  else { risk = 'critical'; recommendation = 'Very invasive. Use tracker blocking or avoid this site.'; }

  return { score, risk, recommendation, concerns };
}

// =============================================================================
// Badge
// =============================================================================
function updateBadge(tabId) {
  const data = tabData[tabId];
  if (!data) return;

  const report = buildReport(data);
  const score = report?.verdict?.score || 0;

  let color;
  if (score <= 15) color = '#2ecc71';
  else if (score <= 40) color = '#e67e22';
  else color = '#e74c3c';

  browser.browserAction.setBadgeText({ tabId, text: String(score) });
  browser.browserAction.setBadgeBackgroundColor({ tabId, color });
}

// =============================================================================
// Tab lifecycle
// =============================================================================
browser.tabs.onRemoved.addListener((tabId) => { delete tabData[tabId]; });
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
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
browser.tabs.onActivated.addListener(({ tabId }) => {
  if (tabData[tabId]) updateBadge(tabId);
});
