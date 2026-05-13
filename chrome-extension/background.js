/**
 * background.js — v3.0.0 aggregator service worker.
 * Routes per-module detection messages into unified per-tab state.
 * Handles: network monitoring, cookie analysis, ToS cache/fetch, verdict, badge.
 */

importScripts('tos-scanner.js');
importScripts('network-domains.js');
importScripts('cookie-database.js');
importScripts('visits.js');
// Window snapshots — rolled-up Overview aggregates. Loaded after visits.js
// so it can read the visitHistory key the moment append fires.
importScripts('snapshots.js');
// Cookie scoper — loaded after cookie-database.js so classifyCookie is
// available for tracker-demotion. Self-contained module: registers its
// own alarm + onAlarm listener at load time.
importScripts('scoper/scoper.js');

// --- Per-tab state ---
const tabData = {};
const domainTosCache = {};
let dashboardTabId = null;
// Serialize trust-list writes so rapid add/remove from the dashboard
// can't lose updates via read-modify-write clobber.
let trustWriteChain = Promise.resolve();

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
// Tab IDs Chrome has already torn down. Late-arriving content-script messages
// would otherwise resurrect tabData for a dead tab; subsequent badge writes
// then reject with "No tab with id: …". We drop those messages instead.
const removedTabs = new Set();
const REMOVED_TABS_CAP = 500;
function markTabRemoved(tabId) {
  removedTabs.add(tabId);
  if (removedTabs.size > REMOVED_TABS_CAP) {
    const it = removedTabs.values();
    for (let i = 0; i < removedTabs.size - REMOVED_TABS_CAP; i++) removedTabs.delete(it.next().value);
  }
}
// Best-effort SSRF guard for bgFetch. Reject non-http(s) and reject hostnames
// that look local/private. Browser DNS may still resolve a public name to a
// private IP, but the response never reaches the page so the worst an
// attacker page can do is induce a fetch — they cannot read it.
const PRIVATE_HOST_RE = /^(?:localhost|.+\.local|.+\.internal|.+\.localhost)$/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
function isSafeBgFetchUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  if (PRIVATE_HOST_RE.test(host)) return false;
  // Bare IPv6 literal (`[::1]`, `[fc00::]/7`, etc.) — disallow all IPv6
  // literals; policy/terms pages never live at one.
  if (host.includes(':') || (host.startsWith('[') && host.endsWith(']'))) return false;
  const m = host.match(IPV4_RE);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127 || a === 169 || a >= 224) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }
  return true;
}

// Manual-redirect fetch for bgFetch. Walks up to MAX_BG_REDIRECTS hops,
// re-checking each Location through isSafeBgFetchUrl before following.
// Without this, a server-side 30x to a private IP would be followed
// silently after the initial URL passed the public-facing check.
const MAX_BG_REDIRECTS = 5;

const _DAY_MS = 24 * 60 * 60 * 1000;
function windowMs(name) {
  return name === 'today' ? _DAY_MS
       : name === 'week'  ? 7  * _DAY_MS
       : name === 'month' ? 30 * _DAY_MS
       : null;
}
async function safeBgFetch(url, hops) {
  let next = url;
  for (let i = 0; i <= hops; i++) {
    if (!isSafeBgFetchUrl(next)) throw new Error('Unsafe redirect target');
    const resp = await fetch(next, { redirect: 'manual' });
    if (resp.type === 'opaqueredirect' || (resp.status >= 300 && resp.status < 400)) {
      const loc = resp.headers.get('location');
      if (!loc) throw new Error('Redirect without Location');
      try { next = new URL(loc, next).href; } catch { throw new Error('Bad redirect URL'); }
      continue;
    }
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    return resp.text();
  }
  throw new Error('Too many redirects');
}

function ensureTab(tabId) {
  if (removedTabs.has(tabId)) return null;
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
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId < 0) return;

    if (details.type === 'main_frame') {
      // A fresh navigation in this tab id — clear any prior removed-tab mark
      // (Chrome reuses ids after a tab is closed).
      removedTabs.delete(details.tabId);
      const tab = ensureTab(details.tabId);
      if (!tab) return;
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

  // --- Per-module detection messages from content scripts ---
  if (msg.type === 'detection' && sender.tab) {
    const tabId = sender.tab.id;
    const tab = ensureTab(tabId);
    if (!tab) return;
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

    // Mirror a compact snapshot to session storage so we can recover the
    // visit record even if the SW goes idle between this detection event
    // and tabs.onRemoved firing. In-memory tabData is lost on SW restart;
    // chrome.storage.session survives until browser close.
    persistPendingVisit(tabId, tab);
    return;
  }

  // --- ToS: checkCache from detect-tosed.js ---
  if (msg.type === 'checkCache' && sender.tab) {
    const domain = msg.domain;
    const cached = domainTosCache[domain] || null;
    if (cached && cached.privacy && cached.terms) {
      // Full cache — set tab data
      const tabId = sender.tab.id;
      const tab = ensureTab(tabId);
      if (tab) {
        tab.modules.tosed = buildTosModuleData(domain, cached.privacy, cached.terms);
        updateBadge(tabId);
      }
    }
    sendResponse(cached);
    return true;
  }

  // --- ToS: bgFetch from detect-tosed.js ---
  if (msg.type === 'bgFetch') {
    const url = msg.url;
    // bgFetch runs in the extension context — it can hit URLs the page
    // itself can't (no CORS, no same-origin). Guard against being abused
    // as an SSRF probe: reject non-http(s) and reject hostnames that
    // resolve to local/private space syntactically (IP literals, .local,
    // .internal, localhost). Browser DNS resolution still applies to
    // names, so this is best-effort; the bigger reason it's safe is
    // that the response is never echoed back to the page.
    if (!isSafeBgFetchUrl(url)) {
      sendResponse(null);
      return true;
    }
    safeBgFetch(url, MAX_BG_REDIRECTS)
      .then(html => {
        const metaRedirect = html.match(/content=["'][^"']*URL=([^"'\s>]+)/i);
        if (metaRedirect && html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length < 500) {
          const redirectUrl = (() => {
            try { return new URL(metaRedirect[1], url).href; } catch { return null; }
          })();
          if (!redirectUrl || !isSafeBgFetchUrl(redirectUrl)) throw new Error('Unsafe meta redirect');
          return safeBgFetch(redirectUrl, MAX_BG_REDIRECTS);
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
        sendResponse(scanText(text));
      })
      .catch(() => {
        sendResponse(null);
      });
    return true;
  }

  // --- Popup: getReport ---
  if (msg.type === 'getReport') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return sendResponse(null);
      const data = tabData[tabs[0].id];
      if (!data) return sendResponse(null);
      sendResponse(buildReport(data));
    });
    return true;
  }

  // --- Dashboard: getFullReport ---
  if (msg.type === 'getFullReport') {
    const targetTabId = msg.tabId || null;

    const resolve = async (tabId) => {
      const data = tabData[tabId];
      if (!data) return sendResponse(null);

      const report = buildReport(data);

      // Cookies: global scan (all cookies, not filtered to this tab)
      try {
        report.rawCookies = await chrome.cookies.getAll({});
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

      sendResponse(report);
    };

    if (targetTabId) {
      resolve(targetTabId);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return sendResponse(null);
        resolve(tabs[0].id);
      });
    }
    return true;
  }

  // --- Dashboard: getOpenTabs (for tab dropdown) ---
  // Returns every http(s) tab, not just tabs we've collected detection
  // data for. SPAs like CNN can take long to fire detection messages; if
  // we limit the dropdown to tabs already in `tabData` the user can't
  // even select the site to see "no live capture yet". With the broader
  // list, fetchTabReport falls through to the noData placeholder for
  // tabs with no report instead of hiding the tab entirely.
  if (msg.type === 'getOpenTabs') {
    chrome.tabs.query({}, (allTabs) => {
      const out = [];
      for (const t of allTabs) {
        if (!t.url) continue;
        let host = '';
        try {
          const u = new URL(t.url);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
          host = u.hostname;
        } catch (e) { continue; }
        const known = tabData[t.id];
        const domain = (known && known.domain) || host;
        // Watcher count: build a quick report and count tracker
        // companies + snoop-vendors. Lets the dropdown signal
        // "this tab has data and how much" without selecting it.
        let watcherCount = null;
        if (known) {
          try {
            const r = buildReport(known);
            const tc = (r && r.trackers && Array.isArray(r.trackers.companies)) ? r.trackers.companies.length : 0;
            watcherCount = tc;
          } catch (e) { watcherCount = 0; }
        }
        out.push({ id: t.id, domain, url: t.url, hasReport: !!known, watcherCount });
      }
      sendResponse(out);
    });
    return true;
  }

  // --- Dashboard: register tab ---
  if (msg.type === 'registerDashboard') {
    // Extension pages don't have sender.tab — use sender's tab via msg or URL match
    if (sender.tab) {
      dashboardTabId = sender.tab.id;
    } else if (sender.url && sender.url.includes('report.html')) {
      // Find the tab by matching the sender's URL
      chrome.tabs.query({}, (tabs) => {
        const match = tabs.find(t => t.url && t.url.startsWith(chrome.runtime.getURL('report.html')));
        if (match) dashboardTabId = match.id;
      });
    }
    return false;
  }

  // --- Dashboard: open or reuse single tab ---
  if (msg.type === 'openDashboard') {
    if (dashboardTabId) {
      chrome.tabs.get(dashboardTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          dashboardTabId = null;
          sendResponse({ existingTabId: null });
        } else {
          sendResponse({ existingTabId: dashboardTabId });
        }
      });
    } else {
      sendResponse({ existingTabId: null });
    }
    return true;
  }

  // --- Cookie cleaning ---
  if (msg.type === 'cleanCookies') {
    (async () => {
      try {
        let deleted = 0;
        if (msg.mode === 'list' && msg.cookies) {
          // Delete specific cookies by domain+name (from report.js category classification)
          for (const c of msg.cookies) {
            const cDomain = c.domain.replace(/^\./, '');
            const protocol = c.secure ? 'https' : 'http';
            const cookieUrl = `${protocol}://${cDomain}${c.path}`;
            try {
              await chrome.cookies.remove({ url: cookieUrl, name: c.name });
              deleted++;
            } catch {}
          }
        } else {
          const domain = new URL(msg.url).hostname;
          const cookies = await chrome.cookies.getAll({ url: msg.url });
          for (const c of cookies) {
            const cDomain = c.domain.replace(/^\./, '');
            const protocol = c.secure ? 'https' : 'http';
            const cookieUrl = `${protocol}://${cDomain}${c.path}`;
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

  // Coverage sub-block source: bucket every cookie by what the scoper
  // policy will do to it. Same logic as scoper.js decideCap, applied as
  // a read-only classification for the dashboard.
  if (msg.type === 'cookies:bucket') {
    chrome.cookies.getAll({}, (cookies) => {
      chrome.storage.local.get('cookieScopeTrust', (o) => {
        const trust = (o && o.cookieScopeTrust) || {};
        const classify = self.classifyCookie || (() => null);
        const buckets = { capped: 0, trusted: 0, killOnClose: 0, total: 0 };
        for (const c of cookies || []) {
          buckets.total++;
          const cls = classify(c.name);
          if (cls && (cls.category === 'Marketing' || cls.category === 'Analytics')) {
            buckets.killOnClose++;
            continue;
          }
          // Simple eTLD+1 (last two labels) — matches scoper.js's etld1Of.
          const host = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
          const labels = host.toLowerCase().split('.').filter(Boolean);
          const etld1 = labels.length >= 2 ? labels.slice(-2).join('.') : null;
          if (etld1 && trust[etld1]) buckets.trusted++;
          else buckets.capped++;
        }
        sendResponse(buckets);
      });
    });
    return true;
  }

  // --- Cookie scoper API (same-extension messages from popup + dashboard) ---
  if (msg.type === 'scoper:get-state') {
    chrome.storage.local.get(
      ['cookieScopeCounters', 'cookieScopeTrust', 'cookieScopeSettings', 'cookieScopeHistory'],
      (s) => sendResponse(s || {})
    );
    return true;
  }

  if (msg.type === 'scoper:set-trust') {
    if (typeof msg.etld1 !== 'string') { sendResponse({ error: 'etld1 required' }); return; }
    if (msg.cap !== 0 && msg.cap !== 30 && msg.cap !== 90) {
      sendResponse({ error: 'cap must be 0, 30, or 90' });
      return;
    }
    // Serialize through a single chain so two rapid trust adds (or an
    // add + remove racing) can't both read the same starting object and
    // clobber each other's update.
    trustWriteChain = trustWriteChain.then(async () => {
      const o = await chrome.storage.local.get('cookieScopeTrust');
      const t = o.cookieScopeTrust || {};
      if (msg.cap === 0) delete t[msg.etld1];
      else t[msg.etld1] = { capDays: msg.cap, addedAt: Date.now() };
      await chrome.storage.local.set({ cookieScopeTrust: t });
      sendResponse({ ok: true, trust: t });
    }).catch((e) => { try { sendResponse({ error: String(e && e.message || e) }); } catch {} });
    return true;
  }

  if (msg.type === 'scoper:set-settings') {
    const min = msg.settings && msg.settings.sweepPeriodMin;
    if (![15, 60, 240, 720].includes(min)) {
      sendResponse({ error: 'sweepPeriodMin must be 15, 60, 240, or 720' });
      return;
    }
    chrome.storage.local.set({ cookieScopeSettings: { sweepPeriodMin: min } }, () => {
      if (typeof self.scoperEnsureAlarm === 'function') {
        self.scoperEnsureAlarm().then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ error: String(e) }));
      } else {
        sendResponse({ error: 'scoper not loaded' });
      }
    });
    return true;
  }

  // --- Visit history API ---
  if (msg.type === 'visits:get') {
    const win = typeof msg.window === 'string' ? msg.window : 'all';
    self.visitsGet(win).then((arr) => sendResponse(arr || []));
    return true;
  }

  if (msg.type === 'visits:clear') {
    self.visitsClear()
      .then(() => self.snapshotsRecompute())
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'snapshots:get') {
    self.snapshotsGet().then((snap) => sendResponse(snap));
    return true;
  }

  if (msg.type === 'snapshots:get-window') {
    self.snapshotsGetWindow(msg.window).then((agg) => sendResponse(agg));
    return true;
  }

  // Windowed scoper impact — sums cookieScopeHistory in the window so
  // Overview can render a story-line ("this week wearehere shortened N
  // cookies and demoted M trackers…"). Per-sweep entries already carry
  // `rewrote` (tightened cookies) + `demotions` (tracker demotions).
  if (msg.type === 'impact:get-window') {
    chrome.storage.local.get('cookieScopeHistory', ({ cookieScopeHistory }) => {
      const arr = Array.isArray(cookieScopeHistory) ? cookieScopeHistory : [];
      const ms = windowMs(msg.window);
      const cutoff = ms == null ? 0 : Date.now() - ms;
      let tightened = 0, demotions = 0, sweeps = 0;
      for (const h of arr) {
        if (h.at < cutoff) continue;
        tightened += h.rewrote || 0;
        demotions += h.demotions || 0;
        sweeps++;
      }
      sendResponse({ tightened, demotions, sweeps, window: msg.window });
    });
    return true;
  }

  if (msg.type === 'scoper:get-alarm') {
    chrome.alarms.get('wearehere-scoper-sweep', (a) => {
      sendResponse(a ? { periodInMinutes: a.periodInMinutes, scheduledTime: a.scheduledTime } : null);
    });
    return true;
  }

  if (msg.type === 'scoper:sweep-now') {
    if (typeof self.scoperSweep !== 'function') {
      console.error('[scoper] scoperSweep not loaded — check importScripts order');
      sendResponse({ error: 'scoper module not loaded' });
      return false;
    }
    self.scoperSweep('manual')
      .then((stats) => sendResponse(stats || {}))
      .catch((err) => {
        console.error('[scoper] sweep-now failed:', err);
        sendResponse({ error: String(err && err.message || err) });
      });
    return true;
  }

  return false;
});

// =============================================================================
// ToS detection handler
// =============================================================================
function handleTosedDetection(tabId, tab, data) {
  if (data.subtype === 'directScan') {
    // Direct scan from a policy/terms page
    const scanResult = { items: data.items, score: data.score, total: data.total };
    const cached = domainTosCache[data.domain] || {};

    const privacyResult = data.pageType === 'privacy' ? scanResult : (cached.privacy || null);
    const termsResult = data.pageType === 'terms' ? scanResult : (cached.terms || null);

    tab.modules.tosed = buildTosModuleData(data.domain, privacyResult, termsResult);

    // Update cache
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
// eTLD+1 compare for first-party vs third-party. Substring matching
// would conflate `foo.com` with `mfoo.com` / `evil-foo.com`. We use the
// last-two-labels heuristic — same naive PSL approximation the rest of
// the codebase uses (acknowledged limitation for `*.co.uk` etc.).
function etld1ForCookie(host) {
  if (!host) return '';
  const cleaned = host.startsWith('.') ? host.slice(1) : host;
  const labels = cleaned.toLowerCase().split('.').filter(Boolean);
  return labels.length < 2 ? cleaned.toLowerCase() : labels.slice(-2).join('.');
}

async function fetchCookies(tabId, url, domain) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!tabData[tabId]) return;

    const pageEtld1 = etld1ForCookie(domain);
    const cookieIsFirstParty = (c) => etld1ForCookie(c.domain) === pageEtld1;
    const firstParty = cookies.filter(cookieIsFirstParty);
    const thirdParty = cookies.filter((c) => !cookieIsFirstParty(c));

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
    const isFirstParty = cookieIsFirstParty;
    let snoops = 0, embeds = 0, essential = 0;
    const vendorMap = {}; // vendor -> { analytics, marketing }
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
    // Marketing wins ties — the more privacy-concerning label surfaces first.
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
  // `companies` is computed AFTER the link-rollup folds clicks into
  // trackerCompanies — see the linked block below. Until then,
  // trackerCompanies only carries cookie + pixel contributions.
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

  // Per-company click bucketing. detect-linked.js attaches a `provider`
  // per item (Google / Meta / Mailchimp / ...). Fold those into the
  // tracker-company map so watcherMech can carry click attribution
  // alongside cookies + pixels. Click-only watchers (provider present
  // but not seen via cookies/pixels) get added as legit watchers — they
  // ARE tracking the user, just via outbound URL params.
  for (const item of (linked.items || [])) {
    const name = item.provider;
    if (!name) continue;
    if (!trackerCompanies[name]) {
      trackerCompanies[name] = { name, purpose: 'Click tracking', count: 0, viaPixels: 0, viaCookies: 0, viaClicks: 0 };
    }
    if (trackerCompanies[name].viaClicks == null) trackerCompanies[name].viaClicks = 0;
    trackerCompanies[name].viaClicks++;
    trackerCompanies[name].count++;
  }

  // Per-company device-id (fingerprinting) attribution. inject.js
  // stack-walks the caller frame on each wrapped API hit and passes its
  // host up via watched.byScript: { 'hotjar.com': { fingerprint: 4 }}.
  // Resolve script host → company via the cooked-items map (which
  // already pairs script domains with company names from detect-cooked.
  // js's COMPANY_MAP). Scripts whose host doesn't appear in any cooked
  // item stay unattributed — they'll fall back to the site-level
  // "device-id reads" summary.
  const hostToCompany = {};
  for (const item of cookedItems) {
    if (item.domain && item.company) hostToCompany[item.domain] = item.company;
  }
  for (const [scriptHost, cats] of Object.entries(watched.byScript || {})) {
    const fp = cats.fingerprint || 0;
    if (!fp) continue;
    let name = hostToCompany[scriptHost];
    if (!name) {
      const root = scriptHost.split('.').slice(-2).join('.');
      name = hostToCompany[root];
    }
    if (!name) continue;
    if (!trackerCompanies[name]) {
      trackerCompanies[name] = { name, purpose: 'Fingerprinting', count: 0, viaPixels: 0, viaCookies: 0, viaClicks: 0, viaDeviceId: 0 };
    }
    if (trackerCompanies[name].viaDeviceId == null) trackerCompanies[name].viaDeviceId = 0;
    trackerCompanies[name].viaDeviceId += fp;
    trackerCompanies[name].count += fp;
  }

  // Build the final ranked companies list after cookie/pixel, click,
  // and device-id contributions have been folded in.
  const companies = Object.values(trackerCompanies).sort((a, b) => b.count - a.count).slice(0, 20);

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

  // Cookies (max 15)
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

  // Tab may have been removed between the message arriving and now;
  // setBadgeText/Color reject in MV3 when the tabId no longer exists.
  chrome.action.setBadgeText({ tabId, text: String(score) }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

// =============================================================================
// Tab lifecycle
// =============================================================================
// Snapshot then evict: a visit is "complete" the moment the user leaves
// it (tab close, or in-tab domain change). We capture the final state
// before clearing tabData so visitHistory has the right value for that
// page-load.
const PENDING_VISIT_KEY = (tabId) => 'pendingVisit:' + tabId;

// Write a compact snapshot of the current tab state to session storage.
// Called after every detection write so the latest known state survives
// SW dormancy. The session-storage record is what snapshotAndEvict reads
// from when in-memory tabData has been cleared.
function persistPendingVisit(tabId, tab) {
  if (!tab || !tab.domain) return;
  try {
    const report = buildReport(tab);
    if (!report) return;
    chrome.storage.session.set({ [PENDING_VISIT_KEY(tabId)]: report });
  } catch (e) {
    console.warn('[visits] pending-write failed for tab', tabId, e);
  }
}

function snapshotAndEvict(tabId) {
  console.log('[visits] onRemoved tab', tabId);
  const data = tabData[tabId];
  const finalize = (report, source) => {
    if (!report) {
      console.log('[visits] skip — no report for tab', tabId);
      return;
    }
    console.log('[visits] snapshot tab', tabId, '·', report.site, '· score', report.verdict && report.verdict.score, '·', source);
    self.visitsAppend(report)
      .then(() => {
        console.log('[visits] persisted', report.site);
        // Recompute snapshots if the cache is stale (>5min). Dashboard
        // reads from windowSnapshots and re-renders on its storage change.
        return self.snapshotsRecomputeIfStale();
      })
      .catch((e) => console.warn('[visits] persist failed', e));
  };

  if (data && data.domain) {
    try { finalize(buildReport(data), 'memory'); }
    catch (e) { console.warn('[visits] snapshot failed for tab', tabId, e); }
    delete tabData[tabId];
    chrome.storage.session.remove(PENDING_VISIT_KEY(tabId));
    return;
  }

  // Memory empty (SW restarted while tab was open) — read the most recent
  // snapshot from session storage and finalize that instead.
  chrome.storage.session.get(PENDING_VISIT_KEY(tabId), (s) => {
    const pending = s && s[PENDING_VISIT_KEY(tabId)];
    if (pending) {
      finalize(pending, 'session');
      chrome.storage.session.remove(PENDING_VISIT_KEY(tabId));
    } else {
      console.log('[visits] skip — no memory + no session record for tab', tabId);
    }
  });
  delete tabData[tabId];
}

// Hourly recompute keeps Overview aggregates fresh even when the user
// isn't actively browsing — the dashboard's "today" cutoff slides every
// hour, and stale snapshots would lag the visible Overview by up to a
// day otherwise.
const SNAPSHOT_PERIOD_MIN = 60;
chrome.alarms.get(self.SNAPSHOT_ALARM, (existing) => {
  if (!existing) {
    chrome.alarms.create(self.SNAPSHOT_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: SNAPSHOT_PERIOD_MIN,
    });
    console.log('[snapshots] alarm set · period=' + SNAPSHOT_PERIOD_MIN + 'min');
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== self.SNAPSHOT_ALARM) return;
  self.snapshotsRecompute()
    .then(() => console.log('[snapshots] recomputed (alarm)'))
    .catch((e) => console.warn('[snapshots] recompute failed', e));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // Mark *before* evict — a late detection message arriving during the
  // async session-storage read inside snapshotAndEvict would otherwise
  // resurrect tabData via ensureTab, then a follow-up badge write
  // rejects with "No tab with id: …".
  markTabRemoved(tabId);
  snapshotAndEvict(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    const oldDomain = tabData[tabId]?.domain;
    try {
      const newDomain = new URL(changeInfo.url).hostname;
      if (oldDomain && oldDomain !== newDomain) {
        snapshotAndEvict(tabId);
      }
    } catch {
      snapshotAndEvict(tabId);
    }
  }
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (tabData[tabId]) updateBadge(tabId);
});
