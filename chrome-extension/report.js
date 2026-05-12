/**
 * report.js — Full-page dashboard for wearehere.
 * Sends { type: 'getFullReport' } to background.js and renders all tabs.
 */

// === Cookie classification data (from wearecooked) ===

const TRACKER_DOMAINS = [
  "doubleclick.net", "google-analytics.com", "googleadservices.com",
  "googlesyndication.com", "facebook.com", "facebook.net",
  "analytics.twitter.com", "ads.twitter.com", "amazon-adsystem.com",
  "adsrvr.org", "adnxs.com", "criteo.com", "outbrain.com",
  "taboola.com", "scorecardresearch.com", "quantserve.com",
  "bluekai.com", "demdex.net", "krxd.net", "rubiconproject.com",
  "pubmatic.com", "casalemedia.com", "openx.net", "indexexchange.com",
  "hotjar.com", "clarity.ms", "mouseflow.com", "fullstory.com",
  "amplitude.com", "mixpanel.com", "segment.io", "segment.com",
  "hubspot.com", "intercom.io", "drift.com",
];

const PURPOSE_DOMAINS = {
  "CDN / Performance": [
    "cloudflare.com", "akamaized.net", "akamai.net", "fastly.net",
    "cloudfront.net", "jsdelivr.net", "unpkg.com", "cdnjs.cloudflare.com",
    "bootstrapcdn.com", "gstatic.com", "ajax.googleapis.com",
  ],
  "Captcha / Security": [
    "recaptcha.net", "hcaptcha.com", "challenges.cloudflare.com",
  ],
  "Social Media Tracking": [
    "youtube.com", "youtu.be", "vimeo.com", "twitch.tv",
    "twitter.com", "x.com", "instagram.com", "linkedin.com",
    "reddit.com", "discord.com", "tiktok.com", "pinterest.com",
  ],
  "E-commerce / Payment": [
    "stripe.com", "paypal.com", "shopify.com", "braintreegateway.com",
    "square.com", "checkout.com",
  ],
};

const TRACKER_PATTERNS = {
  "Analytics / Tracking": [
    "_ga", "_gid", "_gat", "_gcl", "__utm", "amplitude", "mixpanel",
    "mp_", "ahoy_", "_hjid", "_hjSession", "hubspot", "_fbp", "_fbc",
    "intercom", "ajs_", "segment", "_clck", "_clsk", "clarity",
    "plausible", "matomo", "_pk_", "piwik",
  ],
  "Advertising": [
    "IDE", "DSID", "NID", "ANID", "1P_JAR", "APISID", "SSID",
    "fr", "xs", "datr", "sb",
    "muc_ads", "personalization_id",
    "_rdt_uuid", "li_sugr",
    "__gads", "__gpi", "test_cookie",
  ],
  "Session / Auth": [
    "session", "sess", "sid", "csrf", "token", "auth", "login",
    "connect.sid", "PHPSESSID", "JSESSIONID", "ASP.NET_SessionId",
    "remember", "logged_in", "user_id", "_account", "sso",
    "li_at", "twitter_sess", "reddit_session",
  ],
  "Preference": [
    "lang", "locale", "theme", "dark_mode", "consent", "cookie_consent",
    "gdpr", "ccpa", "OptanonConsent", "CookieConsent",
    "timezone", "tz", "country", "region", "pref", "settings",
    "dismiss", "banner", "notice", "accepted",
  ],
  "CDN / Performance": [
    "__cf", "cf_", "__cfduid", "cf_clearance", "cf_bm",
    "_cfuvid", "__cflb",
    "__akamai", "ak_bmsc", "bm_sv", "bm_sz",
    "_fastly", "x-cache",
    "awsalb", "awsalbcors", "AWSALB",
  ],
  "Captcha / Security": [
    "captcha", "recaptcha", "hcaptcha", "challenge", "cf_clearance",
    "turnstile", "__gh_sess", "device_id", "fingerprint",
    "_abck", "bm_sz",
  ],
  "Social Media Tracking": [
    "youtube", "yt-remote", "YSC", "VISITOR_INFO",
    "vimeo_", "twitch",
    "ig_", "instagram",
    "lidc", "player",
  ],
  "E-commerce / Payment": [
    "cart", "basket", "checkout", "stripe", "paypal",
    "shopify", "shop_", "_shopify",
    "wishlist", "recently_viewed", "product",
  ],
};

const COOKIE_RISKY_CATEGORIES = new Set([
  "Analytics / Tracking", "Advertising",
  "Third-party (uncategorized)", "Social Media Tracking",
]);

const CAT_COLORS = {
  "Analytics / Tracking": "#e74c3c",
  "Advertising": "#e67e22",
  "Session / Auth": "#2ecc71",
  "Preference": "#3498db",
  "CDN / Performance": "#1abc9c",
  "Captcha / Security": "#f39c12",
  "Social Media Tracking": "#e84393",
  "E-commerce / Payment": "#00b894",
  "Third-party (uncategorized)": "#9b59b6",
  "Functional / Other": "#95a5a6",
};

function deriveFirstPartyDomains(cookies) {
  const domains = new Set();
  for (const c of cookies) {
    const d = c.domain.toLowerCase().replace(/^\./, "");
    const parts = d.split(".");
    if (parts.length >= 2) {
      domains.add(parts.slice(-2).join("."));
    }
  }
  return domains;
}

function classifyCookieByDomain(domain, name, firstPartyDomains) {
  const nameLower = name.toLowerCase();
  const domainLower = domain.toLowerCase().replace(/^\./, "");

  for (const td of TRACKER_DOMAINS) {
    if (domainLower.includes(td)) {
      return ["ad", "syndication", "doubleclick"].some(kw => td.includes(kw))
        ? "Advertising" : "Analytics / Tracking";
    }
  }

  for (const [category, domains] of Object.entries(PURPOSE_DOMAINS)) {
    for (const pd of domains) {
      if (domainLower.includes(pd)) return category;
    }
  }

  for (const [category, patterns] of Object.entries(TRACKER_PATTERNS)) {
    for (const pattern of patterns) {
      if (nameLower.includes(pattern.toLowerCase())) return category;
    }
  }

  if (firstPartyDomains) {
    const isFirstParty = [...firstPartyDomains].some(
      fp => domainLower === fp || domainLower.endsWith("." + fp)
    );
    if (!isFirstParty) return "Third-party (uncategorized)";
  }

  return "Functional / Other";
}

// === Network dashboard helpers (from wearebaked) ===

const NET_RISKY_CATEGORIES = ['Advertising', 'Analytics', 'Social Tracking', 'Fingerprinting', 'A/B Testing', 'Data Broker'];
const NET_BENIGN_CATEGORIES = ['cdn', 'fonts', 'captcha', 'payment', 'auth', 'maps', 'Video/Media', 'Chat/Support', 'Consent', 'Email/CRM', 'Error Monitoring'];

function netCatClass(category) {
  const map = {
    'Advertising': 'net-cat-advertising',
    'Analytics': 'net-cat-analytics',
    'Social Tracking': 'net-cat-social',
    'Fingerprinting': 'net-cat-fingerprinting',
    'cdn': 'net-cat-cdn',
    'fonts': 'net-cat-fonts',
    'captcha': 'net-cat-captcha',
    'payment': 'net-cat-payment',
    'Error Monitoring': 'net-cat-error-monitoring',
    'A/B Testing': 'net-cat-abtesting',
    'Chat/Support': 'net-cat-chat',
    'Video/Media': 'net-cat-video',
    'Consent': 'net-cat-consent',
    'Email/CRM': 'net-cat-email',
    'auth': 'net-cat-auth',
    'maps': 'net-cat-maps',
    'Data Broker': 'net-cat-databroker'
  };
  return map[category] || 'net-cat-unknown';
}

function netCatColor(category) {
  const map = {
    'Advertising': '#e74c3c',
    'Analytics': '#e67e22',
    'Social Tracking': '#f1c40f',
    'Fingerprinting': '#ff6b6b',
    'cdn': '#2ecc71',
    'fonts': '#3498db',
    'captcha': '#8b8fa3',
    'payment': '#2ecc71',
    'First Party': '#6c5ce7',
    'Error Monitoring': '#e056a0',
    'A/B Testing': '#9b59b6',
    'Chat/Support': '#1abc9c',
    'Video/Media': '#e74c3c',
    'Consent': '#95a5a6',
    'Email/CRM': '#d35400',
    'auth': '#3498db',
    'maps': '#2ecc71',
    'Data Broker': '#e056a0',
    'unknown': '#8b8fa3'
  };
  return map[category] || '#8b8fa3';
}

function netFmtBytes(n) {
  if (!n || n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  const val = n / Math.pow(1024, i);
  return val.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}

function netFmtInterval(ms) {
  const sec = ms / 1000;
  if (sec < 60) return Math.round(sec) + 's';
  return (sec / 60).toFixed(1) + 'min';
}

function netFmtTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

function netExtractDomainFromUrl(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function netAttachToggle(toggleId, wrapId) {
  const wrap = document.getElementById(wrapId);
  const toggle = document.getElementById(toggleId);
  if (!toggle || !wrap) return;
  toggle.addEventListener('click', () => {
    const visible = wrap.style.display !== 'none';
    wrap.style.display = visible ? 'none' : 'block';
    const hint = toggle.querySelector('.toggle-hint');
    if (!hint) return;
    const count = hint.getAttribute('data-count') || '';
    hint.textContent = visible ? (count ? count + ' \u00b7 click to expand' : 'Click to expand') : 'Click to collapse';
  });
}

function netUpdateToggleCount(toggleId, count, label) {
  var toggle = document.getElementById(toggleId);
  if (!toggle) return;
  var hint = toggle.querySelector('.toggle-hint');
  if (!hint) return;
  hint.setAttribute('data-count', count + ' ' + label);
  hint.textContent = count + ' ' + label + ' \u00b7 click to expand';
}

// === Main IIFE ===

(function () {
  'use strict';

  let reportData = null;
  let activeTab = 'overview';
  let networkRefreshInterval = null;
  let cookieRefreshInterval = null;

  // --- Data bridge for graph.js ---
  window._wearehere = {
    getReportData: function () { return reportData; },
    getCurrentTabId: function () { return currentTabId; },
  };

  // --- Init ---
  let currentTabId = null;

  const hashId = parseInt(location.hash.replace('#', ''), 10);
  if (hashId > 0) currentTabId = hashId;

  function loadReport(tabId) {
    const msg = { type: 'getFullReport' };
    if (tabId) msg.tabId = tabId;

    chrome.runtime.sendMessage(msg, (report) => {
      document.getElementById('loading').style.display = 'none';

      if (!report) {
        document.getElementById('empty').style.display = 'flex';
        document.getElementById('report').style.display = 'none';
        return;
      }

      reportData = report;
      document.getElementById('empty').style.display = 'none';
      document.getElementById('report').style.display = 'block';

      buildTabDropdown();
      initTabs();
      var renderers = [renderOverview, renderCookies, renderNetwork, renderTerms, renderTracking, renderGraph];
      for (var i = 0; i < renderers.length; i++) {
        try { renderers[i](); } catch (e) { console.error('Render error in ' + renderers[i].name + ':', e); }
      }
    });
  }

  function buildTabDropdown() {
    chrome.runtime.sendMessage({ type: 'getOpenTabs' }, (tabs) => {
      const select = document.getElementById('tab-select');
      if (!select) return;

      // Always show the dropdown
      select.style.display = '';
      select.innerHTML = '';

      if (!tabs || tabs.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'No tabs';
        select.appendChild(opt);
        return;
      }

      for (const t of tabs) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.domain || 'Tab ' + t.id;
        if (t.id === currentTabId) opt.selected = true;
        select.appendChild(opt);
      }
    });
  }

  const tabSelect = document.getElementById('tab-select');
  if (tabSelect) {
    tabSelect.addEventListener('change', () => {
      currentTabId = parseInt(tabSelect.value, 10);
      document.getElementById('loading').style.display = 'flex';
      document.getElementById('report').style.display = 'none';
      loadReport(currentTabId);
    });
  }

  chrome.runtime.sendMessage({ type: 'registerDashboard' });

  loadReport(currentTabId);
  buildTabDropdown();

  // --- Tab switching ---
  function initTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
        const target = tab.getAttribute('data-tab');
        document.getElementById('panel-' + target).classList.add('active');
        activeTab = target;

        // Start/stop auto-refresh based on active tab
        if (target === 'network') { startNetworkRefresh(); } else { stopNetworkRefresh(); }
        if (target === 'cookies') { startCookieRefresh(); } else { stopCookieRefresh(); }

        // Graph lifecycle
        if (target === 'graph') {
          if (window.WeAreHereGraph) window.WeAreHereGraph.start(reportData);
        } else {
          if (window.WeAreHereGraph) window.WeAreHereGraph.stop();
        }
      });
    });
  }

  // --- Graph renderer ---
  function renderGraph() {
    if (window.WeAreHereGraph) window.WeAreHereGraph.init(reportData);
  }

  // --- Utilities ---
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') node.className = v;
        else if (k === 'textContent') node.textContent = v;
        else if (k === 'innerHTML') node.innerHTML = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, v);
      }
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      for (const child of children) {
        if (typeof child === 'string') node.appendChild(document.createTextNode(child));
        else if (child) node.appendChild(child);
      }
    }
    return node;
  }

  function riskColor(score) {
    if (score <= 15) return 'low';
    if (score <= 40) return 'moderate';
    if (score <= 70) return 'high';
    return 'critical';
  }

  function catClass(category) {
    if (!category) return 'cat-unknown';
    const key = category.toLowerCase().replace(/[\s-]+/g, '');
    const map = {
      advertising: 'cat-advertising',
      analytics: 'cat-analytics',
      databroker: 'cat-databroker',
      social: 'cat-social',
      marketing: 'cat-marketing',
      cdn: 'cat-cdn',
      essential: 'cat-essential',
      fingerprinting: 'cat-fingerprinting',
      errortracking: 'cat-errortracking',
    };
    return map[key] || 'cat-unknown';
  }

  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // --- Cookie helpers ---
  function cookieFmtDate(epoch) {
    if (!epoch) return "\u2014";
    const d = new Date(epoch * 1000);
    if (d.getFullYear() < 2000) return "\u2014";
    const pad = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function cookieCountBy(arr, fn) {
    const counts = {};
    for (const item of arr) {
      const key = fn(item);
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  function cookieSortedEntries(obj) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]);
  }

  function cookieInsightClass(count, warnAt, badAt) {
    if (count > badAt) return "bad";
    if (count > warnAt) return "warn";
    return "ok";
  }

  // --- 1. Overview ---
  function renderOverview() {
    const panel = document.getElementById('panel-overview');
    panel.innerHTML = '';
    const r = reportData;
    const v = r.verdict;
    const rc = riskColor(v.score);

    // Score display
    const scoreDiv = el('div', { className: 'score-display' });
    scoreDiv.appendChild(el('div', { className: 'score-number color-' + rc, textContent: v.score }));
    const meta = el('div', { className: 'score-meta' });
    meta.appendChild(el('div', { className: 'score-risk color-' + rc, textContent: v.risk }));
    meta.appendChild(el('div', { className: 'score-recommendation', textContent: v.recommendation }));
    scoreDiv.appendChild(meta);
    panel.appendChild(scoreDiv);

    const bar = el('div', { className: 'risk-bar' });
    const fill = el('div', { className: 'risk-bar-fill bg-' + rc });
    fill.style.width = v.score + '%';
    bar.appendChild(fill);
    panel.appendChild(bar);

    // At a Glance
    const formFields = r.forms ? r.forms.fieldCount : 0;
    const formTrackers = r.forms ? r.forms.trackersWhileTyping : 0;
    const trCompanyCount = r.trackers.companies?.length || 0;

    panel.appendChild(el('div', { className: 'section-heading mt-16', textContent: 'At a Glance' }));
    const grid = el('div', { className: 'summary-grid' });

    const ckSnoops = r.cookies.snoops || 0;
    const ckSiteDomain = (r.site || '').toLowerCase();
    let ckSub;
    if (ckSnoops > 0) {
      const vendors = (r.cookies.snoopVendors || [])
        .map(v => v.name)
        .filter(n => !ckSiteDomain.includes(n.toLowerCase()))
        .slice(0, 2);
      const ckNoun = ckSnoops === 1 ? 'snoop' : 'snoops';
      ckSub = vendors.length ? `${ckSnoops} ${ckNoun} · ${vendors.join(', ')}` : `${ckSnoops} ${ckNoun}`;
    } else if (r.cookies.thirdParty > 0) {
      ckSub = `${r.cookies.thirdParty} third-party`;
    } else {
      ckSub = 'all first-party';
    }
    grid.appendChild(summaryCard('icons/cooked.png', 'Cookies', r.cookies.total, ckSub, '#e67e22'));
    grid.appendChild(summaryCard('icons/baked.png', 'Network', (r.network?.trackerDomains || 0) + ' trackers', r.network?.totalRequests + ' requests', '#5dade2'));
    grid.appendChild(summaryCard('icons/cooked.png', 'Trackers', trCompanyCount || r.trackers.total, trCompanyCount > 0 ? trCompanyCount + ' compan' + (trCompanyCount !== 1 ? 'ies' : 'y') : (r.trackers.total > 0 ? 'hidden elements' : 'none found'), '#ff6b6b'));
    grid.appendChild(summaryCard('icons/played.png', 'Pressure', r.pressure.tactics.length + ' tactic' + (r.pressure.tactics.length !== 1 ? 's' : ''), r.pressure.score > 0 ? r.pressure.score + '/100' : 'none', '#9b59b6'));
    grid.appendChild(summaryCard('icons/baked.png', 'Selling data', (r.network?.brokerCount || 0) + ' broker' + ((r.network?.brokerCount || 0) !== 1 ? 's' : ''), '', '#ff85a2'));
    grid.appendChild(summaryCard('icons/watched.png', 'Profiling', r.fingerprinting.techniques > 0 ? 'Active' : 'None', r.fingerprinting.techniques + ' technique' + (r.fingerprinting.techniques !== 1 ? 's' : ''), '#e74c3c'));
    grid.appendChild(summaryCard('icons/leaking.png', 'Stored data', r.localData.suspicious > 0 ? r.localData.suspicious + ' suspicious' : 'Clean', r.localData.totalKeys + ' total', '#f1c40f'));
    grid.appendChild(summaryCard('icons/silent.png', 'Watching', formTrackers > 0 ? formTrackers + ' trackers' : 'Clean', formFields + ' field' + (formFields !== 1 ? 's' : ''), '#1abc9c'));
    grid.appendChild(summaryCard('icons/linked.png', 'Clicks', r.linkTracking.percentage + '% tracked', r.linkTracking.tracked + ' of ' + r.linkTracking.total, '#a8e6cf'));
    const tosLabel2 = r.tos.loading ? '...' : (!r.tos.found && r.tos.score === undefined) ? 'N/A' : r.tos.score + '/100';
    grid.appendChild(summaryCard('icons/tosed.png', 'Terms', tosLabel2, r.tos.loading ? 'loading' : r.tos.flagged ? r.tos.flagged.length + ' flagged' : 'not found', '#b39ddb'));

    if (v.concerns.length > 0) {
      const concernsCard = el('div', { className: 'summary-item summary-concerns' });
      concernsCard.appendChild(el('div', { className: 'summary-item-label', textContent: 'Concerns' }));
      const list = el('ul', { className: 'concerns-list' });
      for (const c of v.concerns) {
        const li = el('li');
        li.appendChild(el('span', { className: 'concern-dot' }));
        li.appendChild(document.createTextNode(c));
        list.appendChild(li);
      }
      concernsCard.appendChild(list);
      grid.appendChild(concernsCard);
    }
    panel.appendChild(grid);

    panel.appendChild(el('div', { className: 'section-heading', textContent: 'Score Breakdown' }));
    const breakdownCard = el('div', { className: 'card' });
    const breakdowns = computeBreakdown();
    const totalMax = breakdowns.reduce((sum, b) => sum + b.max, 0);

    // Stacked weight bar
    const SEGMENT_COLORS = {
      Cookies: '#e67e22', Network: '#5dade2', Trackers: '#ff6b6b', Pressure: '#9b59b6',
      'Selling data': '#ff85a2', Profiling: '#e74c3c', 'Stored data': '#f1c40f',
      Watching: '#1abc9c', Clicks: '#a8e6cf', Terms: '#b39ddb',
    };
    const stackedBar = el('div', { className: 'weight-bar' });
    const stackedLabels = el('div', { className: 'weight-labels' });
    for (const b of breakdowns) {
      const widthPct = (b.max / totalMax) * 100;
      const seg = el('div', { className: 'weight-seg' + (b.points > 0 ? ' weight-seg-active' : '') });
      seg.style.width = widthPct + '%';
      seg.style.backgroundColor = SEGMENT_COLORS[b.label] || '#6c5ce7';
      seg.title = b.label + ': +' + b.points + ' / ' + b.max;
      stackedBar.appendChild(seg);

      const lbl = el('div', { className: 'weight-lbl' });
      lbl.style.width = widthPct + '%';
      lbl.appendChild(el('img', { className: 'weight-lbl-icon', src: b.icon, alt: '' }));
      if (widthPct >= 8) lbl.appendChild(document.createTextNode(b.max));
      stackedLabels.appendChild(lbl);
    }
    breakdownCard.appendChild(stackedBar);
    breakdownCard.appendChild(stackedLabels);

    // Per-row breakdown
    for (const b of breakdowns) {
      const row = el('div', { className: 'breakdown-row' });
      if (b.icon) row.appendChild(el('img', { className: 'breakdown-icon', src: b.icon, alt: '' }));
      row.appendChild(el('span', { className: 'breakdown-label', textContent: b.label }));
      const track = el('div', { className: 'breakdown-bar-track' });
      const pct = b.max > 0 && b.points > 0 ? Math.max((b.points / b.max) * 100, 5) : 0;
      const bfill = el('div', { className: 'breakdown-bar-fill' });
      bfill.style.width = pct + '%';
      bfill.style.backgroundColor = SEGMENT_COLORS[b.label] || '#6c5ce7';
      track.appendChild(bfill);
      row.appendChild(track);
      row.appendChild(el('span', { className: 'breakdown-value', textContent: '+' + b.points + ' / ' + b.max }));
      breakdownCard.appendChild(row);
    }
    panel.appendChild(breakdownCard);


  }

  function summaryCard(iconSrc, label, value, sub, color) {
    const item = el('div', { className: 'summary-item' });
    if (color) item.style.borderLeft = '3px solid ' + color;
    const labelRow = el('div', { className: 'summary-item-label' });
    const img = el('img', { className: 'summary-item-icon', src: iconSrc, alt: '' });
    labelRow.appendChild(img);
    labelRow.appendChild(document.createTextNode(label));
    item.appendChild(labelRow);
    item.appendChild(el('div', { className: 'summary-item-value', textContent: String(value) }));
    if (sub) item.appendChild(el('div', { className: 'summary-item-sub', textContent: sub }));
    return item;
  }

  function computeBreakdown() {
    const r = reportData;
    const rows = [];
    let pts;

    pts = 0;
    {
      const ck = r.cookies;
      if (ck.snoops >= 10) pts += 12;
      else if (ck.snoops >= 3) pts += 8;
      else if (ck.snoops >= 1) pts += 3;
      if (ck.embeds >= 16) pts += 2;
      if (ck.longestDays > 730) pts += 2;
      else if (ck.longestDays > 365) pts += 1;
      pts = Math.min(15, pts);
    }
    rows.push({ icon: 'icons/cooked.png', label: 'Cookies', points: pts, max: 15 });

    pts = 0;
    if (r.network?.trackerDomains > 10) pts = 10;
    else if (r.network?.trackerDomains > 3) pts = 5;
    rows.push({ icon: 'icons/baked.png', label: 'Network', points: pts, max: 10 });

    pts = 0;
    if (r.trackers.total > 10) pts = 20;
    else if (r.trackers.total > 3) pts = 10;
    rows.push({ icon: 'icons/cooked.png', label: 'Trackers', points: pts, max: 20 });

    pts = 0;
    if (r.pressure.score >= 60) pts = 15;
    else if (r.pressure.score >= 20) pts = 5;
    rows.push({ icon: 'icons/played.png', label: 'Pressure', points: pts, max: 15 });

    pts = 0;
    if (r.network?.brokerCount > 5) pts = 10;
    else if (r.network?.brokerCount > 0) pts = 5;
    rows.push({ icon: 'icons/baked.png', label: 'Selling data', points: pts, max: 10 });

    pts = 0;
    if (r.fingerprinting.techniques >= 3) pts = 20;
    else if (r.fingerprinting.techniques >= 1) pts = 10;
    rows.push({ icon: 'icons/watched.png', label: 'Profiling', points: pts, max: 20 });

    pts = 0;
    if (r.localData.suspicious > 5) pts = 5;
    rows.push({ icon: 'icons/leaking.png', label: 'Stored data', points: pts, max: 5 });

    rows.push({ icon: 'icons/silent.png', label: 'Watching', points: r.forms?.trackersWhileTyping > 3 ? 10 : 0, max: 10 });

    pts = 0;
    if (r.linkTracking.percentage > 50) pts = 5;
    rows.push({ icon: 'icons/linked.png', label: 'Clicks', points: pts, max: 5 });

    pts = 0;
    if (r.tos && r.tos.score >= 60) pts = 15;
    else if (r.tos && r.tos.score >= 30) pts = 10;
    else if (r.tos && r.tos.score >= 10) pts = 5;
    rows.push({ icon: 'icons/tosed.png', label: 'Terms', points: pts, max: 15 });

    return rows;
  }

  // --- 2. Cookies (ported from wearecooked) ---
  function renderCookies() {
    const panel = document.getElementById('panel-cookies');
    panel.innerHTML = '';
    const cookies = reportData.rawCookies || [];
    const total = cookies.length;

    if (total === 0) {
      panel.innerHTML = '<div class="cookies-dashboard"><p class="tab-tagline">Your browser\'s cookie activity at a glance</p><div class="empty-section">No cookies found for this site.</div></div>';
      return;
    }

    // Classify
    const firstParty = deriveFirstPartyDomains(cookies);
    for (const c of cookies) {
      c._category = classifyCookieByDomain(c.domain, c.name, firstParty);
      const ocdHit = (typeof classifyCookie === 'function') ? classifyCookie(c.name) : null;
      c._ocdCategory = ocdHit ? ocdHit.category : null;
      c._ocdVendor = ocdHit ? ocdHit.vendor : null;
      c._isSnoop = !!(ocdHit && typeof isTrackerCategory === 'function' && isTrackerCategory(ocdHit.category));
      c._expiresStr = c.expirationDate ? cookieFmtDate(c.expirationDate) : "Session";
      c._valueShort = c.value ? (c.value.length > 120 ? c.value.slice(0, 120) + "..." : c.value) : "";
      c._sameSiteLabel = { "no_restriction": "None", "lax": "Lax", "strict": "Strict", "unspecified": "Unspecified" }[c.sameSite] || c.sameSite || "Unspecified";
    }

    // Stats
    const now = new Date();
    const nowEpoch = now.getTime() / 1000;
    const catCounts = cookieCountBy(cookies, c => c._category);
    const domainCounts = cookieCountBy(cookies, c => c.domain);
    const secureCount = cookies.filter(c => c.secure).length;
    const sessionCount = cookies.filter(c => !c.expirationDate).length;
    const persistentCount = total - sessionCount;
    const riskyCount = cookies.filter(c => COOKIE_RISKY_CATEGORIES.has(c._category)).length;
    const riskPct = (riskyCount / total * 100);

    const staleCookies = cookies.filter(c => c.expirationDate && c.expirationDate < nowEpoch);
    const longLived = cookies.filter(c => c.expirationDate && (c.expirationDate - nowEpoch) > 365 * 86400);
    const sameSiteNone = cookies.filter(c => c.sameSite === "no_restriction");
    const thirdPartyCount = riskyCount;
    const firstPartyCount = total - thirdPartyCount;

    // Worst offenders
    const domainScores = {};
    for (const c of cookies) {
      const d = c.domain.toLowerCase().replace(/^\./, "");
      if (!domainScores[d]) domainScores[d] = { domain: d, count: 0, score: 0, reasons: new Set() };
      const ds = domainScores[d];
      ds.count++;
      if (COOKIE_RISKY_CATEGORIES.has(c._category)) {
        ds.score += 3;
        ds.reasons.add(c._category);
      }
      if (c.sameSite === "no_restriction") {
        ds.score += 2;
        ds.reasons.add("Cross-site (SameSite=None)");
      }
      if (!c.secure) {
        ds.score += 1;
        ds.reasons.add("Missing Secure flag");
      }
      if (c.expirationDate && (c.expirationDate - nowEpoch) > 365 * 86400) {
        ds.score += 2;
        ds.reasons.add("Long-lived (1yr+)");
      }
    }
    const worstOffenders = Object.values(domainScores)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15);
    const maxScore = worstOffenders[0]?.score || 1;
    const top8 = worstOffenders.slice(0, 8);

    const catItems = cookieSortedEntries(catCounts);
    const riskClass = riskPct < 30 ? "risk-low" : riskPct < 60 ? "risk-med" : "risk-high";

    // Build HTML
    const html = '<div class="cookies-dashboard">' +
      '<p class="tab-tagline">Your browser\'s cookie activity at a glance</p>' +
      '<div class="ck-cards">' +
        '<div class="ck-card"><div class="ck-label">Total Cookies</div><div class="ck-val">' + total + '</div></div>' +
        '<div class="ck-card"><div class="ck-label">Unique Domains</div><div class="ck-val">' + Object.keys(domainCounts).length + '</div></div>' +
        '<div class="ck-card"><div class="ck-label">Tracking / Ads</div><div class="ck-val ' + riskClass + '">' + riskyCount + ' <span class="ck-val-sub">(' + riskPct.toFixed(0) + '%)</span></div></div>' +
        '<div class="ck-card"><div class="ck-label">Secure (HTTPS)</div><div class="ck-val">' + secureCount + ' <span class="ck-val-sub">/ ' + (total - secureCount) + ' not</span></div></div>' +
        '<div class="ck-card"><div class="ck-label">Session / Persistent</div><div class="ck-val ck-val-sm">' + sessionCount + ' / ' + persistentCount + '</div></div>' +
      '</div>' +

      '<div class="ck-tag-row">' +
        [["Analytics / Tracking"], ["Advertising"], ["Social Media Tracking"], ["E-commerce / Payment"], ["CDN / Performance"], ["Session / Auth"]].map(function(arr) {
          var cat = arr[0];
          var cnt = catCounts[cat] || 0;
          if (cnt === 0) return "";
          return '<span class="ck-tag-chip" style="border-color:' + (CAT_COLORS[cat] || "#95a5a6") + ';color:' + (CAT_COLORS[cat] || "#95a5a6") + '">' + escHtml(cat.replace(" / ", "/")) + ' <strong>' + cnt + '</strong></span>';
        }).join("") +
      '</div>' +

      '<div class="ck-cta-banner">' +
        '<div class="ck-cta-left">' +
          '<div class="ck-cta-title">' + total + ' cookie' + (total !== 1 ? 's' : '') + ' · ' + riskyCount + ' tracking</div>' +
          '<div class="ck-cta-desc">Removes tracking and advertising cookies. Your logins and preferences stay safe.</div>' +
        '</div>' +
        '<button class="ck-cta-btn" id="ck-clean-btn">Clean Cookies</button>' +
      '</div>' +

      '<div class="ck-section">' +
        '<div class="ck-fp-standalone">' +
          '<div class="ck-fp-label">First-party vs third-party</div>' +
          '<div class="ck-fp-bar">' +
            '<div class="ck-fp" style="width:' + (total ? (firstPartyCount/total*100).toFixed(1) : 0) + '%"></div>' +
            '<div class="ck-tp" style="width:' + (total ? (thirdPartyCount/total*100).toFixed(1) : 0) + '%"></div>' +
          '</div>' +
          '<div class="ck-fp-legend">' +
            '<span class="ck-l-fp">First-party: ' + firstPartyCount + ' (' + (total ? (firstPartyCount/total*100).toFixed(0) : 0) + '%)</span>' +
            '<span class="ck-l-tp">Third-party: ' + thirdPartyCount + ' (' + (total ? (thirdPartyCount/total*100).toFixed(0) : 0) + '%)</span>' +
          '</div>' +
        '</div>' +
        '<div class="ck-insights-row">' +
          '<div class="ck-insight ' + cookieInsightClass(staleCookies.length, 10, 50) + '">' +
            '<div class="ck-insight-body"><div class="ck-insight-title">Expired</div><div class="ck-insight-desc">Dead weight — already expired but still stored.</div></div>' +
            '<div class="ck-insight-count">' + staleCookies.length + '</div>' +
          '</div>' +
          '<div class="ck-insight ' + cookieInsightClass(longLived.length, 20, 50) + '">' +
            '<div class="ck-insight-body"><div class="ck-insight-title">Long-Lived</div><div class="ck-insight-desc">Persistent trackers — expiry over 1 year out.</div></div>' +
            '<div class="ck-insight-count">' + longLived.length + '</div>' +
          '</div>' +
          '<div class="ck-insight ' + cookieInsightClass(sameSiteNone.length, 5, 30) + '">' +
            '<div class="ck-insight-body"><div class="ck-insight-title">Cross-Site</div><div class="ck-insight-desc">SameSite=None — follow you across websites.</div></div>' +
            '<div class="ck-insight-count">' + sameSiteNone.length + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="ck-section">' +
        '<h2>Worst Offenders</h2>' +
        top8.map(function(o, i) {
          return '<div class="ck-offender">' +
            '<div class="ck-rank">' + (i+1) + '</div>' +
            '<div class="ck-of-domain">' + escHtml(o.domain) + '</div>' +
            '<div class="ck-of-bar-track"><div class="ck-of-bar-fill" style="width:' + (o.score/maxScore*100).toFixed(0) + '%"></div></div>' +
            '<div class="ck-of-count">' + o.count + '</div>' +
            '<div class="ck-of-reasons">' + [...o.reasons].sort().map(function(r) { return '<span>' + escHtml(r) + '</span>'; }).join("") + '</div>' +
          '</div>';
        }).join("") +
      '</div>' +

      '<div class="ck-section">' +
        '<h2>Categories</h2>' +
        catItems.map(function(arr) {
          var cat = arr[0], cnt = arr[1];
          return '<div class="ck-cat-bar-row">' +
            '<div class="ck-cat-bar-label">' + escHtml(cat) + '</div>' +
            '<div class="ck-cat-bar-track"><div class="ck-cat-bar-fill" style="width:' + Math.max(cnt/total*100, 3).toFixed(1) + '%;background:' + (CAT_COLORS[cat] || "#95a5a6") + '">' + cnt + '</div></div>' +
            '<div class="ck-cat-bar-count">' + (cnt/total*100).toFixed(0) + '%</div>' +
          '</div>';
        }).join("") +
      '</div>' +

      '<div class="ck-section">' +
        '<div class="ck-table-toggle" id="ck-table-toggle">' +
          '<h2>All Cookies</h2>' +
          '<span class="toggle-hint">' + total + ' cookies &middot; click to expand</span>' +
        '</div>' +
        '<div id="ck-table-content" style="display:none">' +
          '<div class="ck-filters">' +
            '<input type="text" id="ck-search" placeholder="Search domain or cookie name...">' +
            '<select id="ck-catFilter">' +
              '<option value="">All Categories</option>' +
              catItems.map(function(arr) { return '<option value="' + escHtml(arr[0]) + '">' + escHtml(arr[0]) + ' (' + arr[1] + ')</option>'; }).join("") +
            '</select>' +
          '</div>' +
          '<div class="ck-table-wrap">' +
            '<table id="ck-cookieTable">' +
              '<thead><tr>' +
                '<th data-sort="0">Domain</th>' +
                '<th data-sort="1">Name</th>' +
                '<th data-sort="2">Value</th>' +
                '<th data-sort="3">Path</th>' +
                '<th data-sort="4">Expires</th>' +
                '<th>Flags</th>' +
                '<th data-sort="6">Category</th>' +
              '</tr></thead>' +
              '<tbody>' +
                cookies.map(function(c) {
                  var cat = c._category;
                  var color = CAT_COLORS[cat] || "#95a5a6";
                  var valDisplay = c._valueShort ? escHtml(c._valueShort) : '<span class="ck-empty">empty</span>';
                  return '<tr data-category="' + escHtml(cat) + '">' +
                    '<td class="ck-domain">' + escHtml(c.domain) + '</td>' +
                    '<td class="ck-name">' + escHtml(c.name) + '</td>' +
                    '<td class="ck-value" title="' + escHtml(c._valueShort) + '">' + valDisplay + '</td>' +
                    '<td>' + escHtml(c.path) + '</td>' +
                    '<td>' + c._expiresStr + '</td>' +
                    '<td class="ck-flags">' +
                      (c.secure ? '<span class="ck-flag ck-secure">Secure</span>' : '') +
                      (c.httpOnly ? '<span class="ck-flag ck-httponly">HttpOnly</span>' : '') +
                      '<span class="ck-flag ck-samesite">SS:' + c._sameSiteLabel + '</span>' +
                    '</td>' +
                    '<td><span class="ck-cat-badge" style="background:' + color + '">' + escHtml(cat) + '</span>' +
                      (c._isSnoop ? '<br><span class="ck-cat-badge" style="background:#c0392b;margin-top:4px;display:inline-block">snoop' + (c._ocdVendor ? ' · ' + escHtml(c._ocdVendor) : '') + '</span>' : '') +
                    '</td>' +
                  '</tr>';
                }).join("") +
              '</tbody>' +
            '</table>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    panel.innerHTML = html;

    // Bind event listeners (no inline handlers for MV3 CSP)
    // Table toggle
    const toggle = document.getElementById("ck-table-toggle");
    const content = document.getElementById("ck-table-content");
    if (toggle && content) {
      toggle.addEventListener("click", function() {
        const open = content.style.display !== "none";
        content.style.display = open ? "none" : "block";
        toggle.querySelector(".toggle-hint").textContent = open
          ? total + " cookies \u00b7 click to expand"
          : "click to collapse";
      });
    }

    // Clean cookies button
    const cleanBtn = document.getElementById("ck-clean-btn");
    if (cleanBtn) {
      cleanBtn.addEventListener("click", function() {
        cleanBtn.textContent = 'Cleaning...';
        cleanBtn.disabled = true;
        // Build list of tracking cookies to delete (by category, not domain)
        var riskyCookies = (reportData.rawCookies || [])
          .filter(function(c) { return COOKIE_RISKY_CATEGORIES.has(c._category); })
          .map(function(c) { return { domain: c.domain, name: c.name, secure: c.secure, path: c.path }; });
        chrome.runtime.sendMessage(
          { type: 'cleanCookies', mode: 'list', cookies: riskyCookies, url: reportData.url },
          function(response) {
            const count = response && response.deleted !== undefined ? response.deleted : 0;
            cleanBtn.textContent = count + ' deleted';
            // Re-render with fresh data after a beat
            setTimeout(function() {
              var msg = { type: 'getFullReport' };
              if (currentTabId) msg.tabId = currentTabId;
              chrome.runtime.sendMessage(msg, function(report) {
                if (report) {
                  reportData = report;
                  try { renderCookies(); } catch (e) { console.error(e); }
                }
              });
            }, 1000);
          }
        );
      });
    }

    // Search and filter
    var searchEl = document.getElementById("ck-search");
    var catFilterEl = document.getElementById("ck-catFilter");
    if (searchEl) searchEl.addEventListener("input", ckFilterTable);
    if (catFilterEl) catFilterEl.addEventListener("change", ckFilterTable);

    // Sort headers
    var sortHeaders = document.querySelectorAll("#ck-cookieTable th[data-sort]");
    sortHeaders.forEach(function(th) {
      th.style.cursor = "pointer";
      th.addEventListener("click", function() {
        ckSortTable(parseInt(th.dataset.sort, 10));
      });
    });
  }

  // Cookie table interactivity
  function ckFilterTable() {
    var searchEl = document.getElementById("ck-search");
    var catFilterEl = document.getElementById("ck-catFilter");
    var search = searchEl ? searchEl.value.toLowerCase() : '';
    var cat = catFilterEl ? catFilterEl.value : '';
    var rows = document.querySelectorAll("#ck-cookieTable tbody tr");
    rows.forEach(function(row) {
      var domain = row.cells[0].textContent.toLowerCase();
      var name = row.cells[1].textContent.toLowerCase();
      var rowCat = row.dataset.category;
      var show = true;
      if (search && !domain.includes(search) && !name.includes(search)) show = false;
      if (cat && rowCat !== cat) show = false;
      row.style.display = show ? "" : "none";
    });
  }

  var ckSortDir = {};
  function ckSortTable(col) {
    var table = document.getElementById("ck-cookieTable");
    if (!table) return;
    var tbody = table.tBodies[0];
    var rows = Array.from(tbody.rows);
    ckSortDir[col] = !ckSortDir[col];
    rows.sort(function(a, b) {
      var va = a.cells[col].textContent.trim();
      var vb = b.cells[col].textContent.trim();
      return ckSortDir[col] ? va.localeCompare(vb) : vb.localeCompare(va);
    });
    rows.forEach(function(r) { tbody.appendChild(r); });
  }

  // --- 3. Network (ported from wearebaked) ---
  var networkTogglesBound = false;

  function renderNetwork() {
    // Default to empty data if missing — still render the zero-state UI
    const data = reportData.networkDashboard || {
      totals: { count: 0, thirdParty: 0 },
      domains: {}, tabs: {}, websockets: {}, requests: [], redirectChains: []
    };

    var netRenderers = [
      function() { netRenderCards(data); },
      function() { netRenderPrivacySummary(data); },
      function() { netRenderDomains(data); },
      function() { netRenderCategories(data); },
      function() { netRenderBrokers(data); },
      function() { netRenderBeacons(data); },
      function() { netRenderNewDomains(data); },
      function() { netRenderRedirects(data); },
      function() { netRenderDataFlow(data); },
      function() { netRenderWebSockets(data); },
      function() { netRenderFeed(data); },
      function() { netRenderTabs(data); },
    ];
    for (var i = 0; i < netRenderers.length; i++) {
      try { netRenderers[i](); } catch (e) { console.error('Network render error:', e); }
    }

    // Only bind toggles/listeners once (they target static HTML elements)
    if (!networkTogglesBound) {
      networkTogglesBound = true;
      netAttachToggle('net-toggle-brokers', 'net-broker-wrap');
      netAttachToggle('net-toggle-beacons', 'net-beacon-wrap');
      netAttachToggle('net-toggle-new', 'net-new-wrap');
      netAttachToggle('net-toggle-redirects', 'net-redirect-wrap');
      netAttachToggle('net-toggle-dataflow', 'net-dataflow-wrap');
      netAttachToggle('net-toggle-ws', 'net-ws-wrap');
      netAttachToggle('net-toggle-feed', 'net-feed-wrap');

      var feedSearch = document.getElementById('net-feed-search');
      var feedCatFilter = document.getElementById('net-feed-cat-filter');
      var feed3pOnly = document.getElementById('net-feed-3p-only');
      if (feedSearch) feedSearch.addEventListener('input', netFilterFeed);
      if (feedCatFilter) feedCatFilter.addEventListener('change', netFilterFeed);
      if (feed3pOnly) feed3pOnly.addEventListener('change', netFilterFeed);

      var chkAuto = document.getElementById('net-chk-auto');
      if (chkAuto) {
        chkAuto.addEventListener('change', function() {
          if (chkAuto.checked) {
            startNetworkRefresh();
          } else {
            stopNetworkRefresh();
          }
        });
      }
    }
  }

  function startNetworkRefresh() {
    if (networkRefreshInterval) return;
    var chkAuto = document.getElementById('net-chk-auto');
    if (chkAuto && !chkAuto.checked) return;

    networkRefreshInterval = setInterval(function() {
      if (activeTab !== 'network') {
        stopNetworkRefresh();
        return;
      }
      var msg = { type: 'getFullReport' };
      if (currentTabId) msg.tabId = currentTabId;
      chrome.runtime.sendMessage(msg, function(report) {
        if (report && report.networkDashboard) {
          reportData = report;
          netRenderCards(report.networkDashboard);
          netRenderPrivacySummary(report.networkDashboard);
          netRenderDomains(report.networkDashboard);
          netRenderCategories(report.networkDashboard);
          netRenderBrokers(report.networkDashboard);
          netRenderBeacons(report.networkDashboard);
          netRenderNewDomains(report.networkDashboard);
          netRenderRedirects(report.networkDashboard);
          netRenderDataFlow(report.networkDashboard);
          netRenderWebSockets(report.networkDashboard);
          netRenderFeed(report.networkDashboard);
          netRenderTabs(report.networkDashboard);
        }
      });
    }, 3000);
  }

  function stopNetworkRefresh() {
    if (networkRefreshInterval) {
      clearInterval(networkRefreshInterval);
      networkRefreshInterval = null;
    }
  }

  function startCookieRefresh() {
    if (cookieRefreshInterval) return;
    cookieRefreshInterval = setInterval(function() {
      if (activeTab !== 'cookies') {
        stopCookieRefresh();
        return;
      }
      var msg = { type: 'getFullReport' };
      if (currentTabId) msg.tabId = currentTabId;
      chrome.runtime.sendMessage(msg, function(report) {
        if (report) {
          reportData = report;
          try { renderCookies(); } catch (e) { console.error('Cookie refresh error:', e); }
        }
      });
    }, 60000);
  }

  function stopCookieRefresh() {
    if (cookieRefreshInterval) {
      clearInterval(cookieRefreshInterval);
      cookieRefreshInterval = null;
    }
  }

  function netRenderCards(data) {
    var totals = data.totals || {};
    var domains = data.domains || {};
    var websockets = data.websockets || {};
    var uniqueDomains = Object.keys(domains).length;
    var thirdPartyDomains = Object.values(domains).filter(function(d) { return (d.thirdPartyOn || []).length > 0; }).length;
    var riskyDomains = Object.values(domains).filter(function(d) { return d.classification && d.classification.risky; }).length;
    var pct = totals.count > 0 ? Math.round((totals.thirdParty / totals.count) * 100) : 0;
    var wsCount = Object.keys(websockets).length;

    var tpScripts = 0;
    for (var dk in domains) {
      var dd = domains[dk];
      if ((dd.thirdPartyOn || []).length > 0 && dd.types && dd.types.script) tpScripts += dd.types.script;
    }

    var cards = [
      { label: 'Total Requests', val: totals.count || 0, cls: 'accent' },
      { label: 'Unique Domains', val: uniqueDomains, cls: 'blue' },
      { label: 'Third-Party', val: pct + '%', cls: pct > 60 ? 'red' : pct > 30 ? 'orange' : 'green' },
      { label: 'Trackers / Ads', val: riskyDomains, cls: riskyDomains > 5 ? 'red' : riskyDomains > 0 ? 'orange' : 'green' },
      { label: '3P Domains', val: thirdPartyDomains, cls: thirdPartyDomains > 10 ? 'orange' : 'blue' },
      { label: '3P Scripts', val: tpScripts, cls: tpScripts > 50 ? 'red' : tpScripts > 20 ? 'orange' : 'green' },
      { label: 'WebSockets', val: wsCount, cls: wsCount > 0 ? 'orange' : 'green' }
    ];

    var container = document.getElementById('net-cards');
    if (!container) return;
    container.textContent = '';
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var card = document.createElement('div');
      card.className = 'net-card';
      var lbl = document.createElement('div');
      lbl.className = 'net-card-label';
      lbl.textContent = c.label;
      var val = document.createElement('div');
      val.className = 'net-card-val net-val-' + c.cls;
      val.textContent = c.val;
      card.appendChild(lbl);
      card.appendChild(val);
      container.appendChild(card);
    }
  }

  function netRenderPrivacySummary(data) {
    var domains = data.domains || {};
    var tabs = data.tabs || {};
    var container = document.getElementById('net-privacy-summary');
    if (!container) return;
    container.textContent = '';
    container.className = 'net-privacy-summary';

    var tabDomains = new Set();
    for (var tk in tabs) {
      if (tabs[tk].domain) tabDomains.add(tabs[tk].domain);
    }
    var visitedCount = tabDomains.size;
    var totalUnique = Object.keys(domains).length;
    var otherCount = Math.max(0, totalUnique - visitedCount);

    var riskyCount = 0, benignCount = 0, unknownCount = 0;
    for (var dk in domains) {
      var cat = domains[dk].classification ? domains[dk].classification.category : 'unknown';
      if (NET_RISKY_CATEGORIES.indexOf(cat) >= 0) riskyCount++;
      else if (NET_BENIGN_CATEGORIES.indexOf(cat) >= 0) benignCount++;
      else if (cat === 'unknown') unknownCount++;
      else benignCount++;
    }

    var sentence = document.createElement('div');
    sentence.className = 'net-privacy-sentence';
    var vs = document.createElement('strong');
    vs.textContent = visitedCount + ' site' + (visitedCount !== 1 ? 's' : '');
    var os = document.createElement('strong');
    os.textContent = otherCount + ' other domain' + (otherCount !== 1 ? 's' : '');
    sentence.appendChild(document.createTextNode('You visited '));
    sentence.appendChild(vs);
    sentence.appendChild(document.createTextNode('. Your browser talked to '));
    sentence.appendChild(os);
    sentence.appendChild(document.createTextNode('.'));
    container.appendChild(sentence);

    var total = riskyCount + benignCount + unknownCount;
    if (total > 0) {
      var bar = document.createElement('div');
      bar.className = 'net-privacy-bar';
      if (riskyCount > 0) {
        var seg = document.createElement('div');
        seg.className = 'net-privacy-bar-segment net-risky';
        seg.style.width = (riskyCount / total * 100) + '%';
        seg.title = riskyCount + ' risky';
        if (riskyCount / total > 0.1) seg.textContent = riskyCount;
        bar.appendChild(seg);
      }
      if (unknownCount > 0) {
        var seg2 = document.createElement('div');
        seg2.className = 'net-privacy-bar-segment net-unknown';
        seg2.style.width = (unknownCount / total * 100) + '%';
        seg2.title = unknownCount + ' unknown';
        if (unknownCount / total > 0.1) seg2.textContent = unknownCount;
        bar.appendChild(seg2);
      }
      if (benignCount > 0) {
        var seg3 = document.createElement('div');
        seg3.className = 'net-privacy-bar-segment net-benign';
        seg3.style.width = (benignCount / total * 100) + '%';
        seg3.title = benignCount + ' benign';
        if (benignCount / total > 0.1) seg3.textContent = benignCount;
        bar.appendChild(seg3);
      }
      container.appendChild(bar);
    }

    var alert = document.createElement('div');
    alert.className = 'net-privacy-alert';
    if (riskyCount > 20) {
      alert.classList.add('net-alert-red');
      alert.textContent = riskyCount + ' tracking-related domains detected';
    } else if (riskyCount > 5) {
      alert.classList.add('net-alert-orange');
      alert.textContent = riskyCount + ' tracking-related domains detected';
    } else {
      alert.classList.add('net-alert-green');
      alert.textContent = riskyCount === 0 ? 'No tracking-related domains detected' : riskyCount + ' tracking-related domain' + (riskyCount !== 1 ? 's' : '') + ' detected';
    }
    container.appendChild(alert);
  }

  function netRenderDomains(data) {
    var domains = data.domains || {};
    var container = document.getElementById('net-domain-list');
    if (!container) return;
    container.textContent = '';

    var concerning = Object.entries(domains)
      .filter(function(e) { return (e[1].thirdPartyOn || []).length > 0; })
      .filter(function(e) {
        var cat = e[1].classification ? e[1].classification.category : 'unknown';
        return (e[1].classification && e[1].classification.risky) || cat === 'unknown';
      });

    var scored = concerning.map(function(e) {
      var domain = e[0], info = e[1];
      var risky = info.classification && info.classification.risky ? 50 : 0;
      var beacon = (info.beaconScore || 0) * 0.3;
      var uploadHeavy = (info.bytesSent > 0 && info.bytesSent > info.bytesReceived * 0.5) ? 20 : 0;
      var thirdPartySpread = ((info.thirdPartyOn || []).length) * 2;
      var score = Math.min(100, risky + beacon + uploadHeavy + thirdPartySpread);
      return [domain, info, score];
    });

    scored.sort(function(a, b) { return b[2] - a[2]; });
    var top = scored.slice(0, 20);

    if (top.length === 0) {
      container.textContent = 'No domains of concern detected. Browse some sites first.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    for (var i = 0; i < top.length; i++) {
      var domain = top[i][0], info = top[i][1], score = top[i][2];
      var item = document.createElement('div');
      item.className = 'net-domain-item';

      var name = document.createElement('span');
      name.className = 'net-domain-name';
      name.textContent = domain;

      var badge = document.createElement('span');
      badge.className = 'net-concern-badge';
      badge.textContent = Math.round(score);
      if (score >= 60) badge.classList.add('net-concern-high');
      else if (score >= 30) badge.classList.add('net-concern-med');
      else badge.classList.add('net-concern-low');

      var catSpan = document.createElement('span');
      catSpan.className = 'net-domain-cat ' + netCatClass(info.classification ? info.classification.category : 'unknown');
      catSpan.textContent = info.classification ? info.classification.category : 'unknown';

      var count = document.createElement('span');
      count.className = 'net-count';
      count.textContent = info.count + ' req';

      item.appendChild(name);
      item.appendChild(badge);
      item.appendChild(catSpan);
      if (info.classification && info.classification.brokerName) {
        var broker = document.createElement('span');
        broker.className = 'net-pill-broker';
        broker.textContent = 'DATA BROKER';
        broker.title = info.classification.brokerName;
        item.appendChild(broker);
      }
      item.appendChild(count);
      container.appendChild(item);
    }
  }

  function netRenderCategories(data) {
    var domains = data.domains || {};
    var container = document.getElementById('net-cat-bars');
    if (!container) return;
    container.textContent = '';

    var cats = {};
    for (var dk in domains) {
      var c = domains[dk].classification ? domains[dk].classification.category : 'unknown';
      cats[c] = (cats[c] || 0) + domains[dk].count;
    }

    var firstPartyReqs = 0;
    for (var dk2 in domains) {
      if ((domains[dk2].thirdPartyOn || []).length === 0) firstPartyReqs += domains[dk2].count;
    }
    if (firstPartyReqs > 0) cats['First Party'] = firstPartyReqs;

    var sorted = Object.entries(cats).sort(function(a, b) { return b[1] - a[1]; });
    var max = sorted.length > 0 ? sorted[0][1] : 1;

    for (var i = 0; i < sorted.length; i++) {
      var cat = sorted[i][0], cnt = sorted[i][1];
      var row = document.createElement('div');
      row.className = 'net-cat-bar-row';

      var label = document.createElement('div');
      label.className = 'net-cat-bar-label';
      label.textContent = cat;

      var track = document.createElement('div');
      track.className = 'net-cat-bar-track';

      var fill = document.createElement('div');
      fill.className = 'net-cat-bar-fill';
      fill.style.width = Math.max(2, (cnt / max) * 100) + '%';
      fill.style.background = netCatColor(cat);
      fill.textContent = cnt;

      track.appendChild(fill);

      var countEl = document.createElement('div');
      countEl.className = 'net-cat-bar-count';
      countEl.textContent = cnt;

      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(countEl);
      container.appendChild(row);
    }
  }

  function netRenderBrokers(data) {
    var domains = data.domains || {};
    var container = document.getElementById('net-broker-list');
    if (!container) return;
    container.textContent = '';

    var brokers = Object.entries(domains)
      .filter(function(e) { return e[1].classification && e[1].classification.brokerName; })
      .sort(function(a, b) { return b[1].count - a[1].count; });

    netUpdateToggleCount('net-toggle-brokers', brokers.length, 'broker' + (brokers.length !== 1 ? 's' : ''));

    if (brokers.length === 0) {
      container.textContent = 'No data broker connections detected yet.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    var groups = {};
    for (var i = 0; i < brokers.length; i++) {
      var domain = brokers[i][0], info = brokers[i][1];
      var type = info.classification.brokerType || 'Other';
      if (!groups[type]) groups[type] = [];
      groups[type].push([domain, info]);
    }

    var typeOrder = ['Consumer Data Broker', 'Data Marketplace', 'Identity Resolution', 'Audience Data'];
    var sortedTypes = Object.keys(groups).sort(function(a, b) {
      var ai = typeOrder.indexOf(a);
      var bi = typeOrder.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    for (var t = 0; t < sortedTypes.length; t++) {
      var typeName = sortedTypes[t];
      var header = document.createElement('div');
      header.className = 'net-broker-type-header';
      header.textContent = typeName + ' (' + groups[typeName].length + ')';
      container.appendChild(header);

      for (var j = 0; j < groups[typeName].length; j++) {
        var bDomain = groups[typeName][j][0], bInfo = groups[typeName][j][1];
        var item = document.createElement('div');
        item.className = 'net-broker-item';

        var nameSpan = document.createElement('span');
        nameSpan.className = 'net-domain-name';
        nameSpan.textContent = bInfo.classification.brokerName + ' (' + bDomain + ')';

        var desc = document.createElement('span');
        desc.className = 'net-broker-desc';
        desc.textContent = bInfo.classification.brokerDesc || '';

        var countSpan = document.createElement('span');
        countSpan.className = 'net-count';
        countSpan.textContent = bInfo.count + ' req';

        item.appendChild(nameSpan);
        item.appendChild(desc);
        item.appendChild(countSpan);
        container.appendChild(item);
      }
    }
  }

  function netRenderBeacons(data) {
    var domains = data.domains || {};
    var container = document.getElementById('net-beacon-list');
    if (!container) return;
    container.textContent = '';

    var beacons = Object.entries(domains)
      .filter(function(e) { return e[1].beaconScore > 0; })
      .sort(function(a, b) { return b[1].beaconScore - a[1].beaconScore; });

    netUpdateToggleCount('net-toggle-beacons', beacons.length, 'beacon' + (beacons.length !== 1 ? 's' : ''));

    if (beacons.length === 0) {
      container.textContent = 'No beaconing detected yet. Regular-interval requests will appear here.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    for (var i = 0; i < beacons.length; i++) {
      var domain = beacons[i][0], info = beacons[i][1];
      var item = document.createElement('div');
      item.className = 'net-beacon-item';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'net-domain-name';
      nameSpan.textContent = domain;

      var catSpan = document.createElement('span');
      catSpan.className = 'net-domain-cat net-cat-beacon';
      catSpan.textContent = 'BEACON';

      var details = document.createElement('span');
      details.className = 'net-beacon-details';
      details.textContent = 'every ' + netFmtInterval(info.beaconInterval) +
        ' \u00b7 score ' + info.beaconScore +
        ' \u00b7 ' + Math.round(info.beaconConfidence * 100) + '% confidence';

      item.appendChild(nameSpan);
      item.appendChild(catSpan);
      item.appendChild(details);
      container.appendChild(item);
    }
  }

  function netRenderNewDomains(data) {
    var domains = data.domains || {};
    var container = document.getElementById('net-new-list');
    if (!container) return;
    container.textContent = '';

    var newDomains = Object.entries(domains)
      .filter(function(e) { return e[1].isNew; })
      .filter(function(e) {
        var cat = e[1].classification ? e[1].classification.category : 'unknown';
        return NET_BENIGN_CATEGORIES.indexOf(cat) < 0;
      })
      .sort(function(a, b) { return b[1].firstSeen - a[1].firstSeen; })
      .slice(0, 30);

    netUpdateToggleCount('net-toggle-new', newDomains.length, 'domain' + (newDomains.length !== 1 ? 's' : ''));

    if (newDomains.length === 0) {
      container.textContent = 'No suspicious new domains this session.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    for (var i = 0; i < newDomains.length; i++) {
      var domain = newDomains[i][0], info = newDomains[i][1];
      var item = document.createElement('div');
      item.className = 'net-domain-item';

      var name = document.createElement('span');
      name.className = 'net-domain-name';
      name.textContent = domain;

      var pill = document.createElement('span');
      pill.className = 'net-pill-new';
      pill.textContent = 'NEW';

      var catSpan = document.createElement('span');
      catSpan.className = 'net-domain-cat ' + netCatClass(info.classification ? info.classification.category : 'unknown');
      catSpan.textContent = info.classification ? info.classification.category : 'unknown';

      var time = document.createElement('span');
      time.className = 'net-count';
      time.textContent = netFmtTime(info.firstSeen);

      item.appendChild(name);
      item.appendChild(pill);
      item.appendChild(catSpan);
      item.appendChild(time);
      container.appendChild(item);
    }
  }

  function netRenderRedirects(data) {
    var redirectChains = data.redirectChains || [];
    var container = document.getElementById('net-redirect-list');
    if (!container) return;
    container.textContent = '';

    netUpdateToggleCount('net-toggle-redirects', redirectChains.length, 'chain' + (redirectChains.length !== 1 ? 's' : ''));

    if (redirectChains.length === 0) {
      container.textContent = 'No redirect chains captured yet.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    var seen = new Set();
    var unique = [];
    for (var i = 0; i < redirectChains.length; i++) {
      var rc = redirectChains[i];
      var chain = rc.chain || [];
      var sig = chain.map(function(u) { return netExtractDomainFromUrl(u); }).join('\u2192');
      if (!seen.has(sig)) {
        seen.add(sig);
        unique.push(rc);
      }
    }

    var show = unique.slice(0, 20);
    for (var j = 0; j < show.length; j++) {
      var rc2 = show[j];
      var chainEl = document.createElement('div');
      chainEl.className = 'net-redirect-chain';

      var hops = (rc2.chain || []).map(function(u) { return netExtractDomainFromUrl(u); });
      for (var k = 0; k < hops.length; k++) {
        var hop = document.createElement('span');
        hop.className = 'net-redirect-hop';
        hop.textContent = hops[k];
        if (k === 0) hop.style.color = '#6c5ce7';
        else if (k === hops.length - 1) hop.style.color = '#e2e4ea';
        else hop.style.color = '#e67e22';
        chainEl.appendChild(hop);

        if (k < hops.length - 1) {
          var arrow = document.createElement('span');
          arrow.className = 'net-redirect-arrow';
          arrow.textContent = '\u2192';
          chainEl.appendChild(arrow);
        }
      }

      var countSpan = document.createElement('span');
      countSpan.className = 'net-count';
      countSpan.textContent = hops.length + ' hops';
      chainEl.appendChild(countSpan);

      container.appendChild(chainEl);
    }
  }

  function netRenderDataFlow(data) {
    var domains = data.domains || {};
    var container = document.getElementById('net-dataflow-list');
    if (!container) return;
    container.textContent = '';

    var withData = Object.entries(domains)
      .filter(function(e) { return e[1].bytesReceived > 0 || e[1].bytesSent > 0; })
      .sort(function(a, b) { return (b[1].bytesSent + b[1].bytesReceived) - (a[1].bytesSent + a[1].bytesReceived); })
      .slice(0, 20);

    netUpdateToggleCount('net-toggle-dataflow', withData.length, 'domain' + (withData.length !== 1 ? 's' : ''));

    if (withData.length === 0) {
      container.textContent = 'No data flow captured yet.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    for (var i = 0; i < withData.length; i++) {
      var domain = withData[i][0], info = withData[i][1];
      var item = document.createElement('div');
      item.className = 'net-dataflow-item';

      var name = document.createElement('span');
      name.className = 'net-domain-name';
      name.textContent = domain;

      var down = document.createElement('span');
      down.className = 'net-dataflow-down';
      down.textContent = '\u2193 ' + netFmtBytes(info.bytesReceived);

      var up = document.createElement('span');
      up.className = 'net-dataflow-up';
      up.textContent = '\u2191 ' + netFmtBytes(info.bytesSent);
      if (info.bytesSent > 0 && info.bytesSent > info.bytesReceived * 0.5) {
        up.classList.add('net-upload-heavy');
      }

      item.appendChild(name);
      item.appendChild(down);
      item.appendChild(up);
      container.appendChild(item);
    }
  }

  function netRenderWebSockets(data) {
    var websockets = data.websockets || {};
    var container = document.getElementById('net-ws-list');
    if (!container) return;
    container.textContent = '';

    var entries = Object.entries(websockets);
    netUpdateToggleCount('net-toggle-ws', entries.length, 'connection' + (entries.length !== 1 ? 's' : ''));

    if (entries.length === 0) {
      container.textContent = 'No WebSocket connections detected.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    for (var i = 0; i < entries.length; i++) {
      var domain = entries[i][0], info = entries[i][1];
      var item = document.createElement('div');
      item.className = 'net-ws-item';

      var name = document.createElement('span');
      name.className = 'net-domain-name';
      name.textContent = domain;

      var active = (Date.now() - info.lastSeen) < 30000;
      var status = document.createElement('span');
      status.className = active ? 'net-ws-active' : 'net-ws-inactive';
      status.textContent = active ? 'ACTIVE' : 'IDLE';

      var details = document.createElement('span');
      details.className = 'net-count';
      details.textContent = info.count + ' msgs \u00b7 since ' + netFmtTime(info.firstSeen);

      item.appendChild(name);
      item.appendChild(status);
      item.appendChild(details);
      container.appendChild(item);
    }
  }

  function netRenderFeed(data) {
    var requests = data.requests || [];
    var container = document.getElementById('net-feed-body');
    if (!container) return;
    container.textContent = '';

    netUpdateToggleCount('net-toggle-feed', requests.length, 'request' + (requests.length !== 1 ? 's' : ''));

    var recent = requests.slice().reverse().slice(0, 100);
    var categories = new Set();

    for (var i = 0; i < recent.length; i++) {
      var r = recent[i];
      var tr = document.createElement('tr');
      tr.setAttribute('data-category', r.classification ? r.classification.category : 'unknown');
      tr.setAttribute('data-third-party', r.thirdParty ? '1' : '0');

      var tdTime = document.createElement('td');
      tdTime.textContent = netFmtTime(r.ts);

      var tdDomain = document.createElement('td');
      tdDomain.textContent = r.domain;
      tdDomain.style.color = (r.classification && r.classification.risky) ? '#e74c3c' : '#6c5ce7';

      var tdType = document.createElement('td');
      tdType.textContent = r.type;

      var tdStatus = document.createElement('td');
      tdStatus.textContent = r.statusCode || '\u2014';
      if (r.statusCode >= 400) tdStatus.style.color = '#e74c3c';

      var tdCat = document.createElement('td');
      var catSpan = document.createElement('span');
      catSpan.className = 'net-domain-cat ' + netCatClass(r.classification ? r.classification.category : 'unknown');
      catSpan.textContent = r.classification ? r.classification.category : 'unknown';
      tdCat.appendChild(catSpan);

      var tdThird = document.createElement('td');
      tdThird.textContent = r.thirdParty ? 'Yes' : 'No';
      tdThird.className = r.thirdParty ? 'net-third-yes' : 'net-third-no';

      tr.appendChild(tdTime);
      tr.appendChild(tdDomain);
      tr.appendChild(tdType);
      tr.appendChild(tdStatus);
      tr.appendChild(tdCat);
      tr.appendChild(tdThird);
      container.appendChild(tr);

      categories.add(r.classification ? r.classification.category : 'unknown');
    }

    // Populate category dropdown
    var select = document.getElementById('net-feed-cat-filter');
    if (select) {
      var current = select.value;
      select.textContent = '';
      var allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.textContent = 'All Categories';
      select.appendChild(allOpt);
      var catArr = Array.from(categories).sort();
      for (var j = 0; j < catArr.length; j++) {
        var opt = document.createElement('option');
        opt.value = catArr[j];
        opt.textContent = catArr[j];
        select.appendChild(opt);
      }
      select.value = current;
    }

    netFilterFeed();
  }

  function netFilterFeed() {
    var searchEl = document.getElementById('net-feed-search');
    var catEl = document.getElementById('net-feed-cat-filter');
    var tpEl = document.getElementById('net-feed-3p-only');
    var search = searchEl ? searchEl.value.toLowerCase() : '';
    var cat = catEl ? catEl.value : '';
    var thirdOnly = tpEl ? tpEl.checked : false;

    var rows = document.querySelectorAll('#net-feed-body tr');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var domainTd = row.children[1];
      var domain = domainTd ? domainTd.textContent.toLowerCase() : '';
      var rowCat = row.getAttribute('data-category');
      var rowTP = row.getAttribute('data-third-party') === '1';

      var matchSearch = !search || domain.includes(search);
      var matchCat = !cat || rowCat === cat;
      var matchTP = !thirdOnly || rowTP;

      row.style.display = (matchSearch && matchCat && matchTP) ? '' : 'none';
    }
  }

  function netRenderTabs(data) {
    var tabs = data.tabs || {};
    var container = document.getElementById('net-tab-list');
    if (!container) return;
    container.textContent = '';

    var tabEntries = Object.entries(tabs)
      .filter(function(e) { return e[1].domain; })
      .sort(function(a, b) { return b[1].requests - a[1].requests; });

    if (tabEntries.length === 0) {
      container.textContent = 'No active tabs tracked yet.';
      container.style.color = '#8b8fa3';
      container.style.fontStyle = 'italic';
      return;
    }

    for (var i = 0; i < tabEntries.length; i++) {
      var tab = tabEntries[i][1];
      var item = document.createElement('div');
      item.className = 'net-tab-item';

      var domainEl = document.createElement('div');
      domainEl.className = 'net-tab-domain';
      domainEl.textContent = tab.domain;

      var stats = document.createElement('div');
      stats.className = 'net-tab-stats';
      stats.textContent = tab.requests + ' requests';

      var third = document.createElement('div');
      third.className = 'net-tab-third';
      var tp = (tab.thirdParties || []).length;
      third.textContent = tp > 0 ? tp + ' third-party domains' : 'No third-party connections';
      if (tp === 0) third.style.color = '#2ecc71';

      item.appendChild(domainEl);
      item.appendChild(stats);
      item.appendChild(third);
      container.appendChild(item);
    }
  }

  // --- 4. Terms ---
  function renderTerms() {
    const panel = document.getElementById('panel-terms');
    panel.innerHTML = '';
    const tos = reportData.tos;

    if (!tos) {
      panel.appendChild(el('div', { className: 'empty-section', textContent: 'No terms data available.' }));
      return;
    }

    if (tos.loading) {
      panel.innerHTML = '<div class="tos-loading-msg">Couldn\'t analyze — try visiting their privacy policy page directly, then come back here.</div>';
      return;
    }

    if (tos.found === false) {
      panel.innerHTML = '<div class="tos-not-found">Couldn\'t find a terms or privacy policy page for this site. Look for a link at the bottom of their homepage.</div>';
      return;
    }

    // Score header
    const header = el('div', { className: 'tos-header' });
    const rc = riskColor(tos.score);
    const scoreRow = el('div', { className: 'tos-score-display' });
    scoreRow.appendChild(el('div', { className: 'tos-score-number color-' + rc, textContent: tos.score + '/100' }));
    const label = el('div');
    label.appendChild(el('div', { className: 'tos-score-label', textContent: 'toxicity score' }));
    scoreRow.appendChild(label);
    header.appendChild(scoreRow);
    header.appendChild(el('div', { className: 'tos-tagline', textContent: 'Watch what you agree to.' }));
    panel.appendChild(header);

    // Category display names grouped under headings
    const CATEGORY_GROUPS = {
      'Data practices': {
        'data-sharing': 'Data sharing & selling',
        'surveillance': 'Tracking & profiling',
        'retention': 'Data retention',
      },
      'Your rights': {
        'law-enforcement': 'Law enforcement access',
        'rights-erosion': 'Rights & liability waivers',
        'unilateral-control': 'Unilateral changes',
      },
    };

    function renderPolicySection(title, data) {
      if (!data) return;
      const section = el('div', { className: 'tos-policy-section' });
      section.appendChild(el('div', { className: 'tos-section-title', textContent: title }));

      // Score 0 with no items = couldn't actually read the policy
      if (data.score === 0 && (!data.items || data.items.length === 0)) {
        section.appendChild(el('div', { className: 'tos-not-analyzed', textContent: 'Couldn\'t analyze — try visiting their ' + title.toLowerCase() + ' page directly, then come back here.' }));
        panel.appendChild(section);
        return;
      }

      const sectionRc = riskColor(data.score);
      section.appendChild(el('div', { className: 'tos-section-score color-' + sectionRc, textContent: data.score + '/100' }));

      const itemMap = {};
      for (const item of (data.items || [])) {
        itemMap[item.pattern] = (itemMap[item.pattern] || 0) + item.count;
      }

      let hasItems = false;
      for (const [groupName, categories] of Object.entries(CATEGORY_GROUPS)) {
        const groupItems = [];
        for (const [key, label] of Object.entries(categories)) {
          if (itemMap[key]) groupItems.push({ label, count: itemMap[key] });
        }
        if (groupItems.length === 0) continue;
        hasItems = true;
        section.appendChild(el('div', { className: 'tos-group-heading', textContent: groupName }));
        for (const gi of groupItems) {
          const row = el('div', { className: 'tos-item-row' });
          row.appendChild(el('span', { className: 'tos-item-label', textContent: gi.label }));
          row.appendChild(el('span', { className: 'tos-item-count', textContent: gi.count }));
          section.appendChild(row);
        }
      }

      if (!hasItems) {
        section.appendChild(el('div', { className: 'tos-clean', textContent: 'Nothing flagged.' }));
      }

      panel.appendChild(section);
    }

    renderPolicySection('Privacy Policy', tos.privacy);
    renderPolicySection('Terms of Service', tos.terms);

    // If neither separate section available, fall back to combined flagged list
    if (!tos.privacy && !tos.terms && tos.flagged && tos.flagged.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Flagged Clauses' }));
      const card = el('div', { className: 'card' });
      for (const f of tos.flagged) {
        const item = el('div', { className: 'tos-flagged-item' });
        item.textContent = f.label || f.type;
        if (f.count && f.count > 1) {
          item.appendChild(el('span', { className: 'text-dim', textContent: ' (' + f.count + ' matches)' }));
        }
        card.appendChild(item);
      }
      panel.appendChild(card);
    }
  }

  // --- 5. Tracking (Fingerprinting + Forms + Storage + Links) ---
  function renderTracking() {
    const panel = document.getElementById('panel-tracking');
    panel.innerHTML = '';

    panel.appendChild(el('div', { className: 'tab-tagline', textContent: 'How this site watches and tracks you' }));

    const grid = el('div', { className: 'tracking-grid' });

    // --- Who's Tracking You (from cooked — pixels, iframes, beacons) ---
    const secTrackers = el('div', { className: 'tracking-section' });
    const tr = reportData.trackers;
    const trCompanies = tr.companies || [];
    const trTotal = tr.total || 0;
    const trCompanyCount = trCompanies.length;
    const trCount = trCompanyCount > 0 ? trCompanyCount + ' compan' + (trCompanyCount !== 1 ? 'ies' : 'y') : (trTotal > 0 ? trTotal + ' hidden element' + (trTotal !== 1 ? 's' : '') : null);
    secTrackers.appendChild(trackingSectionHeader('icons/cooked.png', "Who's tracking you", trCount, '#ff6b6b'));

    if (trCompanies.length > 0) {
      // Group companies by purpose
      const purposeGroups = {};
      for (const c of trCompanies) {
        const purpose = c.purpose || 'Other';
        if (!purposeGroups[purpose]) purposeGroups[purpose] = [];
        purposeGroups[purpose].push(c);
      }
      const purposeOrder = ['Advertising', 'Analytics', 'Social Tracking', 'Fingerprinting', 'Data broker', 'Other'];
      const rendered = new Set();
      for (const purpose of purposeOrder) {
        if (purposeGroups[purpose]) {
          renderTrackerPurpose(secTrackers, purpose, purposeGroups[purpose]);
          rendered.add(purpose);
        }
      }
      for (const [purpose, companies] of Object.entries(purposeGroups)) {
        if (!rendered.has(purpose)) renderTrackerPurpose(secTrackers, purpose, companies);
      }
    } else if (trTotal > 0) {
      secTrackers.appendChild(el('div', { className: 'text-dim', textContent: trTotal + ' hidden tracking elements found (no company names resolved).' }));
    } else {
      secTrackers.appendChild(el('div', { className: 'text-dim', textContent: 'No hidden trackers found.' }));
    }
    grid.appendChild(secTrackers);

    // --- Who's Selling Your Data (from baked — data brokers) ---
    const secBrokers = el('div', { className: 'tracking-section' });
    const brokers = reportData.network?.brokers || [];
    const brokerCount = brokers.length > 0 ? brokers.length + ' broker' + (brokers.length !== 1 ? 's' : '') : null;
    secBrokers.appendChild(trackingSectionHeader('icons/baked.png', "Who's selling your data", brokerCount, '#ff85a2'));

    if (brokers.length > 0) {
      // Group by type
      const typeGroups = {};
      for (const b of brokers) {
        const type = b.type || 'Other';
        if (!typeGroups[type]) typeGroups[type] = [];
        typeGroups[type].push(b);
      }
      const typeOrder = ['Data Marketplace', 'Identity Resolution', 'Audience Data', 'Consumer Data Broker', 'Other'];
      const renderedTypes = new Set();
      for (const type of typeOrder) {
        if (typeGroups[type]) {
          renderBrokerType(secBrokers, type, typeGroups[type]);
          renderedTypes.add(type);
        }
      }
      for (const [type, items] of Object.entries(typeGroups)) {
        if (!renderedTypes.has(type)) renderBrokerType(secBrokers, type, items);
      }
    } else {
      secBrokers.appendChild(el('div', { className: 'text-dim', textContent: 'No data brokers detected.' }));
    }
    grid.appendChild(secBrokers);

    // --- Dark Patterns (from played module) ---
    const secPressure = el('div', { className: 'tracking-section' });
    const pr = reportData.pressure || { score: 0, tactics: [] };
    const prTactics = pr.tactics || [];
    const prCount = prTactics.length > 0 ? pr.score + '/100 · ' + prTactics.length + ' tactic' + (prTactics.length !== 1 ? 's' : '') : null;
    secPressure.appendChild(trackingSectionHeader('icons/played.png', 'Tricking you into buying', prCount, '#9b59b6'));

    if (prTactics.length > 0) {
      for (const t of prTactics) {
        const row = el('div', { className: 'pressure-row' });
        row.appendChild(el('span', { className: 'pressure-row-label', textContent: t.tactic }));
        if (t.count) {
          row.appendChild(el('span', { className: 'pressure-row-count', textContent: t.count + 'x' }));
        }
        secPressure.appendChild(row);
      }
      if (pr.score >= 60) {
        secPressure.appendChild(el('div', { className: 'pressure-verdict pressure-verdict-high', textContent: 'Heavy manipulation — be careful here.' }));
      } else if (pr.score >= 20) {
        secPressure.appendChild(el('div', { className: 'pressure-verdict pressure-verdict-mid', textContent: 'Mild pressure tactics detected.' }));
      }
    } else {
      secPressure.appendChild(el('div', { className: 'text-dim', textContent: 'No dark patterns detected.' }));
    }
    grid.appendChild(secPressure);

    // --- Fingerprinting ---
    const secFp = el('div', { className: 'tracking-section' });
    const fp = reportData.fingerprinting;
    const fpItems = fp.items || [];
    const fpCount = fpItems.length > 0 ? fpItems.length + ' technique' + (fpItems.length !== 1 ? 's' : '') : null;
    secFp.appendChild(trackingSectionHeader('icons/watched.png', 'Reading your device to identify you', fpCount, '#e74c3c'));

    const FRIENDLY_NAMES = {
      'Canvas.toDataURL': 'Drew a hidden image to ID your device',
      'WebGL.getParameter': 'Read your graphics card info',
      'AudioContext.createOscillator': 'Used audio to fingerprint your device',
      'Navigator.hardwareConcurrency': 'Read your CPU info',
      'Navigator.languages': 'Checked your language settings',
      'Navigator.deviceMemory': 'Read your RAM size',
      'Screen.width': 'Read your screen resolution',
      'Screen.colorDepth': 'Read your display color depth',
      'Clipboard.readText': 'Tried to read your clipboard',
      'Clipboard.read': 'Tried to read your clipboard',
      'Geolocation.getCurrentPosition': 'Requested your location',
      'Geolocation.watchPosition': 'Tracking your location',
      'Notification.requestPermission': 'Asked to send you notifications',
      'Battery.getBattery': 'Read your battery status',
      'Connection.type': 'Read your network connection type',
    };
    const CATEGORY_LABELS = { fingerprint: 'Identifying your device', permission: 'Accessing your data' };
    const CATEGORY_ORDER = ['fingerprint', 'permission'];

    if (fpItems.length > 0) {
      const grouped = {};
      for (const item of fpItems) {
        if (!grouped[item.category]) grouped[item.category] = [];
        grouped[item.category].push(item);
      }

      for (const cat of CATEGORY_ORDER) {
        const catItems = grouped[cat];
        if (!catItems || catItems.length === 0) continue;
        secFp.appendChild(el('div', { className: 'fp-cat-heading', textContent: CATEGORY_LABELS[cat] || cat }));
        catItems.sort((a, b) => b.count - a.count);
        for (const item of catItems) {
          const row = el('div', { className: 'fp-row' });
          row.appendChild(el('span', { className: 'fp-row-label', textContent: FRIENDLY_NAMES[item.api] || item.api }));
          row.appendChild(el('span', { className: 'fp-row-count', textContent: item.count + 'x' }));
          secFp.appendChild(row);
        }
      }
    } else {
      secFp.appendChild(el('div', { className: 'fp-status fp-status-none', textContent: 'No fingerprinting detected' }));
    }
    grid.appendChild(secFp);

    // --- Storage ---
    const secStorage = el('div', { className: 'tracking-section' });
    const ld = reportData.localData;
    const storageCount = ld.suspicious > 0 ? ld.suspicious + ' suspicious out of ' + ld.totalKeys : null;
    secStorage.appendChild(trackingSectionHeader('icons/leaking.png', 'What they store in your browser', storageCount, '#f1c40f'));

    if (ld.suspicious > 0 && ld.byCategory && Object.keys(ld.byCategory).length > 0) {
      const catOrder = ['Cross-site tracking', 'Advertising', 'Fingerprinting', 'PII exposure', 'PII', 'Tracking'];
      const rendered = new Set();
      for (const cat of catOrder) {
        const keys = ld.byCategory[cat];
        if (!keys || keys.length === 0) continue;
        rendered.add(cat);
        secStorage.appendChild(buildDataCategory(cat, keys));
      }
      for (const [cat, keys] of Object.entries(ld.byCategory)) {
        if (rendered.has(cat) || !keys || keys.length === 0) continue;
        secStorage.appendChild(buildDataCategory(cat, keys));
      }
    } else if (ld.totalKeys > 0) {
      secStorage.appendChild(el('div', { className: 'text-dim', textContent: ld.totalKeys + ' items stored, nothing suspicious.' }));
    } else {
      secStorage.appendChild(el('div', { className: 'text-dim', textContent: 'No local storage data found.' }));
    }
    grid.appendChild(secStorage);

    // --- Forms ---
    const secForms = el('div', { className: 'tracking-section' });
    const f = reportData.forms;
    const formCount = f && f.trackersWhileTyping > 0 ? f.trackersWhileTyping + ' tracker' + (f.trackersWhileTyping !== 1 ? 's' : '') : null;
    secForms.appendChild(trackingSectionHeader('icons/silent.png', 'Watching what you type', formCount, '#1abc9c'));

    if (f && f.fields && f.fields.length > 0) {
      secForms.appendChild(el('div', { className: 'card-title', textContent: 'Tracked fields' }));
      const list = el('div', { className: 'form-field-list' });
      for (const field of f.fields) {
        list.appendChild(el('span', { className: 'form-field-tag', textContent: escHtml(field) }));
      }
      secForms.appendChild(list);

      if (f.trackersWhileTyping > 0) {
        if (f.trackerNames && f.trackerNames.length > 0) {
          const names = el('div', { className: 'data-service-list' });
          for (const n of f.trackerNames) {
            names.appendChild(el('span', { className: 'data-service-chip', innerHTML: '<span class="data-service-name">' + escHtml(n) + '</span>' }));
          }
          secForms.appendChild(names);
        }
      } else {
        secForms.appendChild(el('div', { className: 'form-status form-status-ok', textContent: 'No trackers watching these fields.' }));
      }
    } else {
      secForms.appendChild(el('div', { className: 'text-dim', textContent: 'No form fields on this page.' }));
    }
    grid.appendChild(secForms);

    // --- Links ---
    const secLinks = el('div', { className: 'tracking-section' });
    const lt = reportData.linkTracking;
    const linkCount = lt.tracked > 0 ? lt.tracked + ' tracked out of ' + lt.total : null;
    secLinks.appendChild(trackingSectionHeader('icons/linked.png', 'How they follow your clicks', linkCount, '#a8e6cf'));

    if (lt.details && lt.details.length > 0) {
      // Group by provider
      const LINK_PARAM_PROVIDERS = {
        utm_source: 'Google Analytics', utm_medium: 'Google Analytics', utm_campaign: 'Google Analytics',
        utm_term: 'Google Analytics', utm_content: 'Google Analytics', utm_id: 'Google Analytics',
        gclid: 'Google', dclid: 'Google', _ga: 'Google', _gl: 'Google',
        fbclid: 'Meta', igshid: 'Instagram',
        msclkid: 'Microsoft', mc_eid: 'Mailchimp', mc_cid: 'Mailchimp',
        _hsenc: 'HubSpot', _hsmi: 'HubSpot', _openstat: 'OpenStat',
        yclid: 'Yandex', twclid: 'X', ttclid: 'TikTok',
        li_fat_id: 'LinkedIn', ref_src: 'Referral', ref_url: 'Referral',
      };
      const providerCounts = {};
      for (const link of lt.details) {
        const params = link.trackingParams || [];
        const seen = new Set();
        for (const p of params) {
          const prov = LINK_PARAM_PROVIDERS[p] || 'Other';
          if (!seen.has(prov)) { seen.add(prov); providerCounts[prov] = (providerCounts[prov] || 0) + 1; }
        }
        if (link.isRedirectWrapper && link.wrapperName) {
          const w = link.wrapperName;
          if (!seen.has(w)) { seen.add(w); providerCounts[w] = (providerCounts[w] || 0) + 1; }
        }
      }
      const sorted = Object.entries(providerCounts).sort((a, b) => b[1] - a[1]);

      // Summary line
      secLinks.appendChild(el('div', { className: 'text-dim mb-8', textContent: lt.percentage + '% of links on this page tag your clicks' }));

      // Provider chips
      const chipList = el('div', { className: 'data-service-list mb-16' });
      for (const [name, count] of sorted) {
        const chip = el('span', { className: 'data-service-chip' });
        chip.appendChild(el('span', { className: 'data-service-name', textContent: name }));
        if (count > 1) chip.appendChild(el('span', { className: 'data-service-count', textContent: '(' + count + ')' }));
        chipList.appendChild(chip);
      }
      secLinks.appendChild(chipList);
    } else if (lt.total > 0) {
      secLinks.appendChild(el('div', { className: 'text-dim', textContent: 'No tracking parameters found in links.' }));
    } else {
      secLinks.appendChild(el('div', { className: 'text-dim', textContent: 'No links found on this page.' }));
    }
    grid.appendChild(secLinks);

    panel.appendChild(grid);
  }

  function trackingSectionHeader(iconSrc, text, countText, color) {
    const header = el('div', { className: 'tracking-section-header' });
    if (color) header.style.borderBottom = '2px solid ' + color;
    header.appendChild(el('img', { src: iconSrc, className: 'tracking-section-icon', width: 20, height: 20 }));
    header.appendChild(document.createTextNode(text));
    if (countText) {
      header.appendChild(el('span', { className: 'tracking-section-count', textContent: '\u00b7 ' + countText }));
    }
    return header;
  }

  function renderTrackerPurpose(container, purpose, companies) {
    const cat = el('div', { className: 'data-category' });
    const header = el('div', { className: 'data-category-header' });
    const totalCount = companies.reduce((sum, c) => sum + (c.count || 1), 0);
    header.appendChild(el('span', { className: 'data-category-count', textContent: totalCount }));
    header.appendChild(el('span', { className: 'data-category-name', textContent: purpose }));
    cat.appendChild(header);

    const sorted = [...companies].sort((a, b) => (b.count || 1) - (a.count || 1));
    const chipList = el('div', { className: 'data-service-list' });
    for (const c of sorted) {
      const chip = el('span', { className: 'data-service-chip' });
      chip.appendChild(el('span', { className: 'data-service-name', textContent: c.name }));
      if ((c.count || 1) > 1) chip.appendChild(el('span', { className: 'data-service-count', textContent: '(' + c.count + ')' }));
      // Source breakdown: cookie-only vs pixel-only vs mixed. cookie-only is the
      // surprise — these are vendors that have NO network pixel but DO have
      // tracker cookies (e.g. first-party Google SID family on google.com).
      const viaCookies = c.viaCookies || 0;
      const viaPixels = c.viaPixels || 0;
      if (viaCookies > 0 && viaPixels === 0) {
        chip.appendChild(el('span', { className: 'data-service-source', textContent: ' · via cookies' }));
      } else if (viaCookies > 0 && viaPixels > 0) {
        chip.appendChild(el('span', { className: 'data-service-source', textContent: ' · pixels + cookies' }));
      }
      chipList.appendChild(chip);
    }
    cat.appendChild(chipList);
    container.appendChild(cat);
  }

  function renderBrokerType(container, type, brokers) {
    const cat = el('div', { className: 'data-category data-category-broker' });
    const header = el('div', { className: 'data-category-header' });
    header.appendChild(el('span', { className: 'data-category-count', textContent: brokers.length }));
    header.appendChild(el('span', { className: 'data-category-name', textContent: type }));
    cat.appendChild(header);

    const sorted = [...brokers].sort((a, b) => (b.count || 0) - (a.count || 0));
    for (const b of sorted) {
      const row = el('div', { className: 'broker-row' });
      row.appendChild(el('span', { className: 'broker-row-name', textContent: b.name }));
      if (b.desc) row.appendChild(el('span', { className: 'broker-row-desc', textContent: b.desc }));
      cat.appendChild(row);
    }
    container.appendChild(cat);
  }

  const STORAGE_KEY_SERVICES = [
    { pattern: /^_ga|^_gid|^_gat|^_gcl/i, name: 'Google Analytics' },
    { pattern: /^__gads|^__gpi|^test_cookie|googlesyndication|googlead/i, name: 'Google Ads' },
    { pattern: /^_fbp$|^_fbc$/i, name: 'Facebook Pixel' },
    { pattern: /fbclid/i, name: 'Facebook' },
    { pattern: /^_hjid|^_hjSession|^_hjAbsolute/i, name: 'Hotjar' },
    { pattern: /amplitude/i, name: 'Amplitude' },
    { pattern: /mixpanel|^mp_/i, name: 'Mixpanel' },
    { pattern: /hubspot/i, name: 'HubSpot' },
    { pattern: /intercom/i, name: 'Intercom' },
    { pattern: /^ajs_|segment/i, name: 'Segment' },
    { pattern: /hotjar/i, name: 'Hotjar' },
    { pattern: /fullstory/i, name: 'FullStory' },
    { pattern: /logrocket/i, name: 'LogRocket' },
    { pattern: /mouseflow/i, name: 'Mouseflow' },
    { pattern: /^_clck|^_clsk|clarity/i, name: 'Microsoft Clarity' },
    { pattern: /optimizely/i, name: 'Optimizely' },
    { pattern: /permutive/i, name: 'Permutive' },
    { pattern: /quantcast|^_qc/i, name: 'Quantcast' },
    { pattern: /criteo/i, name: 'Criteo' },
    { pattern: /taboola/i, name: 'Taboola' },
    { pattern: /outbrain/i, name: 'Outbrain' },
    { pattern: /adroll/i, name: 'AdRoll' },
    { pattern: /rtbhouse/i, name: 'RTB House' },
    { pattern: /^TT_|^tt_/i, name: 'TikTok' },
    { pattern: /singular/i, name: 'Singular' },
    { pattern: /doubleclick/i, name: 'DoubleClick' },
    { pattern: /^ahoy_/i, name: 'Ahoy' },
    { pattern: /plausible/i, name: 'Plausible' },
    { pattern: /matomo|^_pk_|piwik/i, name: 'Matomo' },
    { pattern: /^gclid|^msclkid|^utm_/i, name: 'Ad click tracking' },
    { pattern: /^IDE$|^DSID$|^NID$|^ANID$|^1P_JAR$/i, name: 'Google' },
    { pattern: /^yt-remote-|^yt-player/i, name: 'YouTube' },
    { pattern: /^sb_|^bm_/i, name: 'Bing' },
    { pattern: /^_pin_|^_pinterest/i, name: 'Pinterest' },
    { pattern: /^_snap|^sc_/i, name: 'Snapchat' },
    { pattern: /twitter|^twid|^ct0$/i, name: 'X (Twitter)' },
    { pattern: /^sp_|spotify/i, name: 'Spotify' },
    { pattern: /^lms_|linkedin/i, name: 'LinkedIn' },
    { pattern: /^__stripe/i, name: 'Stripe' },
    { pattern: /^_shopify|^cart_/i, name: 'Shopify' },
    { pattern: /^csrf|^session|^auth/i, name: 'Site auth' },
    { pattern: /^visitor_id|^client_id|^distinct_id|^device_id|^browser_id|^machine_id/i, name: 'Device fingerprint' },
    { pattern: /^__cf_/i, name: 'Cloudflare' },
    { pattern: /^_dd_|datadog/i, name: 'Datadog' },
    { pattern: /sentry/i, name: 'Sentry' },
    { pattern: /newrelic|^NRBA/i, name: 'New Relic' },
    { pattern: /^__hssc|^__hstc|^__hsfp|^hubspotutk/i, name: 'HubSpot' },
    { pattern: /^_uetsid|^_uetvid/i, name: 'Microsoft Ads' },
    // Site-specific tracking keys
    { pattern: /^events-buffer|^good-visit|^search_impression|^screen-instance|^recent-subreddits|^feed-|^redesign/i, name: 'Reddit' },
    { pattern: /^amzn|^csm-|^session-id|^ubid-|^x-wl-uid/i, name: 'Amazon' },
    { pattern: /^ebay|^nonsession|^dp1$/i, name: 'eBay' },
    { pattern: /^_ym_|yandex/i, name: 'Yandex' },
    { pattern: /^ab\.|^experiment|^feature[-_]flag/i, name: 'A/B testing' },
    { pattern: /impression|^viewed[-_]|^seen[-_]/i, name: 'Impression tracking' },
    { pattern: /^event[-_]|^analytics[-_]|^tracking[-_]/i, name: 'Event tracking' },
    { pattern: /^consent|^gdpr|^cookie[-_]pref|^optout/i, name: 'Consent management' },
    { pattern: /^recently[-_]|^recent[-_]|^history[-_]|^last[-_]viewed/i, name: 'Browsing history' },
    { pattern: /^cache[-_]|[-_]cache$/i, name: 'Local cache' },
  ];

  function identifyService(keyName) {
    for (const s of STORAGE_KEY_SERVICES) {
      if (s.pattern.test(keyName)) return s.name;
    }
    return null;
  }

  function humanizeKey(key) {
    const k = key.toLowerCase();
    if (/event|buffer|log/.test(k)) return 'Stores user activity events';
    if (/impression|view/.test(k)) return 'Tracks what you\'ve seen';
    if (/visit|session|instance/.test(k)) return 'Tracks your browsing session';
    if (/search|query/.test(k)) return 'Tracks your search activity';
    if (/screen|page/.test(k)) return 'Tracks pages you visit';
    if (/cache|store/.test(k)) return 'Cached data for tracking';
    if (/id|uid|uuid|token/.test(k)) return 'Unique identifier for tracking';
    if (/pref|setting|config/.test(k)) return 'Stores your preferences';
    if (/consent|gdpr|opt/.test(k)) return 'Cookie consent state';
    if (/experiment|ab[._-]|variant/.test(k)) return 'A/B test assignment';
    return null;
  }

  function buildDataCategory(cat, keys) {
    const div = el('div', { className: 'data-category' });
    const header = el('div', { className: 'data-category-header' });
    header.appendChild(el('span', { className: 'data-category-count', textContent: keys.length }));
    header.appendChild(el('span', { className: 'data-category-name', textContent: cat }));
    div.appendChild(header);

    // Group keys by service name
    const groups = {};
    const others = [];
    for (const key of keys) {
      const keyName = typeof key === 'string' ? key : key.key || String(key);
      const service = identifyService(keyName);
      if (service) {
        if (!groups[service]) groups[service] = 0;
        groups[service]++;
      } else {
        others.push(keyName);
      }
    }

    // Render service groups
    const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const serviceList = el('div', { className: 'data-service-list' });
      for (const [name, count] of sorted) {
        const chip = el('span', { className: 'data-service-chip' });
        chip.appendChild(el('span', { className: 'data-service-name', textContent: name }));
        if (count > 1) chip.appendChild(el('span', { className: 'data-service-count', textContent: '(' + count + ')' }));
        serviceList.appendChild(chip);
      }
      if (others.length > 0) {
        serviceList.appendChild(el('span', { className: 'data-service-chip data-service-other', textContent: others.length + ' other' + (others.length > 1 ? 's' : '') }));
      }
      div.appendChild(serviceList);
    } else {
      // No known services — show raw keys with humanized tooltips
      const list = el('div', { className: 'data-key-list' });
      for (const key of keys) {
        const keyName = typeof key === 'string' ? key : key.key || String(key);
        const keyEl = el('span', { className: 'data-key', textContent: escHtml(keyName) });
        const friendly = humanizeKey(keyName);
        if (friendly) keyEl.title = friendly;
        list.appendChild(keyEl);
      }
      div.appendChild(list);
    }

    return div;
  }

  function highlightTrackingParams(escaped) {
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'msclkid', 'mc_eid', '_ga', 'ref', 'affiliate', 'click_id', 'tracking_id'];
    let result = escaped;
    for (const param of trackingParams) {
      const regex = new RegExp('(' + param + '=[^&\\s]*)', 'gi');
      result = result.replace(regex, '<span class="tracked-param">$1</span>');
    }
    return result;
  }

  function truncateStr(str, max) {
    if (str.length <= max) return str;
    return str.substring(0, max) + '...';
  }
})();
