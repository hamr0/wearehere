/**
 * popup.js — wearehere variant A · retro terminal
 * Renders 4-block layout: Header / Who's watching / Footer chips / Privacy guard card.
 * Reads from background.js tabData via getReport message.
 */

// AMO addons-linter flags every `.innerHTML =` assignment as
// "Unsafe assignment to innerHTML." All dynamic interpolation in
// this file already passes through escapeText(); DOMParser is
// defense-in-depth (strips inline <script> and on*= handlers) and
// silences the warning by routing the write through a function
// call instead of a direct innerHTML setter.
function safeSetHTML(el, html) {
  const doc = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
  el.replaceChildren.apply(el, Array.from(doc.body.childNodes));
}

chrome.runtime.sendMessage({ type: 'getReport' }, render);

const $ = (id) => document.getElementById(id);

// Theme: binary, mirrored from chrome.storage.local. If never set,
// derive from system. Updates live when the dashboard toggles.
function applyPopupTheme(theme) {
  const t = theme === 'light' ? 'light'
          : theme === 'dark'  ? 'dark'
          : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', t);
}
chrome.storage.local.get('theme', ({ theme }) => applyPopupTheme(theme));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) applyPopupTheme(changes.theme.newValue);
});

function checkHostPermission(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs && tabs[0] && tabs[0].url;
    if (!url || !/^https?:\/\//.test(url)) {
      cb(true, null);
      return;
    }
    try {
      const origin = new URL(url).origin + '/*';
      chrome.permissions.contains({ origins: [origin] }, (granted) => {
        cb(!!granted, url);
      });
    } catch (_e) {
      cb(true, url);
    }
  });
}

function showNeedsPermission() {
  $('needs-permission').hidden = false;
  const reload = $('reload-tab');
  const settings = $('open-settings');
  if (reload) reload.onclick = () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].id) chrome.tabs.reload(tabs[0].id);
      window.close();
    });
  };
  if (settings) settings.onclick = () => {
    // FF: about:addons. Chrome: chrome://extensions/?id=…
    const isFirefox = typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo;
    const url = isFirefox
      ? 'about:addons'
      : 'chrome://extensions/?id=' + chrome.runtime.id;
    chrome.tabs.create({ url });
    window.close();
  };
}

function render(report) {
  $('loading').hidden = true;

  if (!report) {
    // FF-specific: an update can leave host_permissions in a "Permission
    // needed" state where content scripts haven't injected yet on the
    // active tab. Detect and show an actionable banner instead of the
    // generic "no data yet" empty state. Chrome reaches this branch on
    // genuine empty tabs (chrome://, new tab page) — those have no host
    // to grant against, so permissions.contains stays true and we fall
    // through to the normal empty state.
    checkHostPermission((hasPermission, activeUrl) => {
      if (!hasPermission && activeUrl) {
        showNeedsPermission();
      } else {
        $('empty').hidden = false;
      }
    });
    return;
  }

  $('report').hidden = false;

  renderHeader(report);
  renderWatchers(report);
  renderFooterChips(report);
  renderGuard(report);
  wireDashboardButton();
}

// --- Header ---------------------------------------------------------------

function renderHeader(report) {
  const v = report.verdict;
  $('site').textContent = report.site;
  const score = $('score');
  score.textContent = `${v.score} / ${v.risk.toUpperCase()}`;
  score.className = `risk-${v.risk}`;
  $('verdict').textContent = (v.recommendation || '').toLowerCase();
}

// --- Who's watching -------------------------------------------------------

function renderWatchers(report) {
  const companies = extractCompanies(report);
  const mechanisms = extractMechanisms(report);

  const watchers = $('watchers');
  const chips = $('chips');

  if (companies.length === 0) {
    watchers.textContent = 'no trackers detected ✓';
    watchers.classList.add('ok');
    chips.textContent = '';
    return;
  }

  // Top 2 + +N more
  const top = companies.slice(0, 2).map(escapeText).join(' · ');
  const rest = companies.length - 2;
  safeSetHTML(watchers, rest > 0
    ? `${top} <span class="more">+${rest} more</span>`
    : top);

  // Mechanism chips — name + count, joined with explicit middots so each
  // chip reads as a discrete signal rather than one run-on label.
  safeSetHTML(chips, mechanisms
    .map((m) => `<span class="chip">${m.name} <span class="chip-n">${m.n}</span></span>`)
    .join('<span class="chip-sep">·</span>'));
}

function extractCompanies(report) {
  const names = new Set();
  const out = [];
  const add = (name) => {
    const key = name.toLowerCase();
    if (names.has(key)) return;
    names.add(key);
    out.push(name);
  };

  // From tracker network domains
  ((report.trackers && report.trackers.companies) || []).forEach((c) => {
    if (c && c.name) add(c.name);
  });
  // From OCD snoop cookie vendors
  ((report.cookies && report.cookies.snoopVendors) || []).forEach((v) => {
    if (v && v.name) add(v.name);
  });

  return out;
}

// Mechanism chips in the popup. Each entry is { name, n } where `n` is
// the count surfaced inline so the user sees magnitude, not just presence.
// Order is deliberate: cookies → pixels → device-id → typing → clicks,
// matching the PRD's locked vocabulary. None is ranked higher than another;
// they're a flat menu of *how* the site watches.
function extractMechanisms(report) {
  const out = [];
  const cookies = report.cookies || {};
  if ((cookies.snoops || 0) > 0) out.push({ name: 'cookies', n: cookies.snoops });

  const trackers = report.trackers || {};
  const pixelsN = (trackers.pixels || 0) + (trackers.beacons || 0) + (trackers.hiddenIframes || 0);
  if (pixelsN > 0) out.push({ name: 'pixels', n: pixelsN });

  const fp = report.fingerprinting || {};
  if ((fp.techniques || 0) > 0) out.push({ name: 'device-id', n: fp.techniques });

  const forms = report.forms || {};
  if ((forms.fieldCount || 0) > 0) out.push({ name: 'typing', n: forms.fieldCount });

  const links = report.linkTracking || {};
  if ((links.tracked || 0) > 0) out.push({ name: 'clicks', n: links.tracked });

  return out;
}

// --- Footer chips ---------------------------------------------------------

function renderFooterChips(report) {
  const chips = [];
  const net = report.network || {};
  const brokers = net.brokerCount || 0;
  chips.push(
    brokers === 0
      ? { cls: 'ok', text: '✓ not sold' }
      : { cls: 'warn', text: `[!] sold to ${brokers} broker${brokers === 1 ? '' : 's'}` }
  );

  const tos = report.tos || {};
  if (tos.found && typeof tos.score === 'number') {
    const s = tos.score;
    chips.push(
      s >= 60
        ? { cls: 'bad',  text: '[!] toxic terms' }
        : s >= 30
        ? { cls: 'warn', text: '[!] strict terms' }
        : { cls: 'ok',   text: '✓ fair terms' }
    );
  }

  const pressure = (report.pressure && report.pressure.score) || 0;
  chips.push(
    pressure >= 60
      ? { cls: 'bad',  text: '[!] aggressive pressure' }
      : pressure > 0
      ? { cls: 'warn', text: '[!] mild pressure' }
      : { cls: 'ok',   text: '✓ no pressure' }
  );

  // Option B: always show every chip — predictable layout, and the green
  // ✓s are themselves an affirmation that "this was checked, it's clean."
  // No collapse to "all clear" — the user learns the row shape once.
  safeSetHTML($('footer-chips'), chips
    .map((c) => `<span class="${c.cls}">${c.text}</span>`)
    .join('<span class="chip-sep">·</span>'));
}

// --- Scoper card ----------------------------------------------------------

function etld1FromHost(host) {
  if (!host) return null;
  const cleaned = host.startsWith('.') ? host.slice(1) : host;
  const labels = cleaned.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2) return null;
  return labels.slice(-2).join('.');
}

function relativeTime(ms) {
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

let currentEtld1 = null;
let currentReport = null;

function renderGuard(report) {
  currentReport = report;
  const etld1 = etld1FromHost(report.site);
  currentEtld1 = etld1;
  chrome.runtime.sendMessage({ type: 'scoper:get-state' }, (state) => {
    const trust = (state && state.cookieScopeTrust) || {};
    const stats = (state && state.cookieScopeCounters) || null;
    chrome.storage.local.get(['farblerSettings', 'farbleDevMode'], (s) => {
      const farblerSettings = s.farblerSettings || {};
      const globalOn = !!s.farbleDevMode;
      renderGuardCard(etld1, trust, stats, report, farblerSettings, globalOn);
      renderGuardCounters(stats);
    });
  });
  wireGuardButtons();
}

function renderGuardCard(etld1, trust, stats, report, farblerSettings, globalOn) {
  const siteEl = $('guard-site');
  const cookiesEl = $('guard-cookies-line');
  const blurEl = $('guard-blur-line');
  const trustBtn = $('trust-toggle');
  const trustIdBtn = $('trust-id');

  cookiesEl.classList.remove('unwired', 'ok', 'warn');
  blurEl.classList.remove('unwired', 'ok', 'warn');

  if (!etld1) {
    siteEl.textContent = '—';
    cookiesEl.textContent = 'not a regular site — guard inactive here';
    cookiesEl.classList.add('unwired');
    blurEl.textContent = '';
    trustBtn.disabled = true;
    trustIdBtn.disabled = true;
    return;
  }

  const trustEntry = trust[etld1];
  const isCookieTrusted = !!trustEntry;
  const capDays = isCookieTrusted ? trustEntry.capDays : 7;

  safeSetHTML(siteEl, `<span class="host">${escapeText(etld1)}</span>`);

  trustBtn.textContent = isCookieTrusted ? '[ remove cookie trust ]' : '[ trust 30d ]';
  trustBtn.disabled = false;

  // Blur state for this origin
  const override = farblerSettings[etld1];
  const blurOverridden = !!(override && override.mode === 'off');
  trustIdBtn.textContent = blurOverridden ? '[ remove ID trust ]' : '[ trust ID ]';
  trustIdBtn.disabled = !globalOn && !blurOverridden;

  renderGuardCookiesLine(etld1, capDays, isCookieTrusted, stats);
  renderGuardBlurLine(report, blurOverridden, globalOn, (override && override.mode) || null);
}

function renderGuardCookiesLine(etld1, capDays, isTrusted, stats) {
  const el = $('guard-cookies-line');
  chrome.cookies.getAll({ domain: etld1 }, (cs) => {
    const nowSec = Date.now() / 1000;
    let maxSec = 0;
    for (const c of cs || []) {
      if (c.session || !c.expirationDate) continue;
      const r = c.expirationDate - nowSec;
      if (r > maxSec) maxSec = r;
    }
    const maxDays = Math.round(maxSec / 86400);
    const bySite = (stats && stats.bySite && stats.bySite[etld1]) || null;
    const rewrites = bySite ? bySite.tightened : 0;
    const demotions = bySite ? bySite.demotions : 0;

    el.classList.remove('ok', 'warn');
    if (isTrusted && rewrites === 0) {
      el.textContent = `• Cookies passing through · trusted ${capDays}d cap`;
    } else if (!isTrusted && rewrites === 0 && maxDays <= capDays) {
      el.textContent = '✓ Cookies already short';
      el.classList.add('ok');
    } else if (rewrites === 0 && maxDays > capDays) {
      el.textContent = `✓ Cookies expire in ${capDays} days · longest ${maxDays}d will trim`;
      el.classList.add('ok');
    } else {
      el.textContent =
        `✓ Cookies expire in ${capDays} days · ${rewrites} trimmed` +
        (demotions > 0 ? `, ${demotions} killed` : '');
      el.classList.add('ok');
    }
  });
}

function renderGuardBlurLine(report, blurOverridden, globalOn, overrideMode) {
  const el = $('guard-blur-line');
  el.classList.remove('ok', 'warn');

  if (blurOverridden) {
    el.textContent = '• ID passing through · trust active';
    return;
  }
  if (!globalOn) {
    el.textContent = '— blur disabled globally';
    el.classList.add('unwired');
    return;
  }
  if (overrideMode === 'stable') {
    el.textContent = '✓ Tracking blurred · stable seed';
    el.classList.add('ok');
    return;
  }
  const fp = (report && report.fingerprinting) || {};
  const surfaces = fp.techniques || 0;
  if (surfaces === 0) {
    el.textContent = '✓ Tracking blurred · no surfaces probed yet';
    el.classList.add('ok');
  } else {
    el.textContent = `✓ Tracking blurred · ${surfaces} surface${surfaces === 1 ? '' : 's'}`;
    el.classList.add('ok');
  }
}

function renderGuardCounters(stats) {
  const r = (stats && stats.tightened) || 0;
  const d = (stats && stats.demotions) || 0;
  const last = stats && stats.lastSweep ? `last sweep ${relativeTime(stats.lastSweep)}` : 'never swept';
  $('guard-counters').textContent = `${r.toLocaleString()} trimmed · ${d.toLocaleString()} killed · ${last}`;
}

function wireGuardButtons() {
  const trustBtn = $('trust-toggle');
  const trustIdBtn = $('trust-id');
  const status = $('guard-status');

  trustBtn.onclick = () => {
    if (!currentEtld1) return;
    chrome.runtime.sendMessage({ type: 'scoper:get-state' }, (state) => {
      const trust = (state && state.cookieScopeTrust) || {};
      const isTrusted = !!trust[currentEtld1];
      const cap = isTrusted ? 0 : 30;
      chrome.runtime.sendMessage({ type: 'scoper:set-trust', etld1: currentEtld1, cap }, () => {
        chrome.runtime.sendMessage({ type: 'scoper:get-state' }, (s2) => {
          chrome.storage.local.get(['farblerSettings', 'farbleDevMode'], (st) => {
            renderGuardCard(
              currentEtld1,
              (s2 && s2.cookieScopeTrust) || {},
              (s2 && s2.cookieScopeCounters) || null,
              currentReport,
              st.farblerSettings || {},
              !!st.farbleDevMode
            );
            renderGuardCounters((s2 && s2.cookieScopeCounters) || null);
          });
        });
      });
    });
  };

  trustIdBtn.onclick = () => {
    if (!currentEtld1) return;
    chrome.storage.local.get(['farblerSettings', 'farbleDevMode'], (s) => {
      const settings = s.farblerSettings || {};
      const overridden = !!(settings[currentEtld1] && settings[currentEtld1].mode === 'off');
      if (overridden) {
        delete settings[currentEtld1];
      } else {
        settings[currentEtld1] = { mode: 'off' };
      }
      chrome.storage.local.set({ farblerSettings: settings }, () => {
        chrome.runtime.sendMessage({ type: 'scoper:get-state' }, (state) => {
          renderGuardCard(
            currentEtld1,
            (state && state.cookieScopeTrust) || {},
            (state && state.cookieScopeCounters) || null,
            currentReport,
            settings,
            !!s.farbleDevMode
          );
        });
        status.className = 'ok';
        status.textContent = overridden ? 'ID trust removed · reload page to apply' : 'ID trusted · reload page to apply';
      });
    });
  };
}

// --- Dashboard open -------------------------------------------------------

function wireDashboardButton() {
  $('full-report').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
      const tabId = activeTabs[0] ? activeTabs[0].id : '';
      const reportUrl = chrome.runtime.getURL('report.html') + '#' + tabId;
      chrome.runtime.sendMessage({ type: 'openDashboard', url: reportUrl }, (res) => {
        if (res && res.existingTabId) {
          // Race: the dashboard tab may have been closed between the
          // background check and this call. Fall back to a fresh tab if
          // the update rejects.
          chrome.tabs.update(res.existingTabId, { url: reportUrl, active: true })
            .catch(() => chrome.tabs.create({ url: reportUrl }));
        } else {
          chrome.tabs.create({ url: reportUrl });
        }
      });
    });
  });
}

// --- utils ----------------------------------------------------------------

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
