/**
 * report.js — wearehere dashboard · variant A (retro terminal)
 * Three tabs: Overview · Watchers · Cookie scoper.
 * Reads current-tab data via background.js getFullReport.
 * Storage-dependent blocks (cross-session aggregates, scoper state) render
 * as placeholders until Phases 1, 2, 4, 5 land.
 */

const $ = (id) => document.getElementById(id);

const tabIdFromHash = parseInt(location.hash.replace('#', ''), 10);
const tabId = Number.isFinite(tabIdFromHash) ? tabIdFromHash : null;

// Theme: binary — 'dark' or 'light'. If never set, derive from system on
// first load but don't persist until the user clicks the toggle.
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const btn = $('theme-toggle');
  if (btn) btn.textContent = `[ ${t} ]`;
}
chrome.storage.local.get('theme', ({ theme }) => {
  const initial = (theme === 'light' || theme === 'dark')
    ? theme
    : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(initial);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.theme) applyTheme(changes.theme.newValue);
});

chrome.runtime.sendMessage({ type: 'getFullReport', tabId }, init);

function init(report) {
  $('loading').hidden = true;
  $('report').hidden = false;

  // Let background know this tab IS the dashboard so subsequent
  // openDashboard clicks reuse it instead of opening a new tab.
  // sender.tab is missing for extension-page senders, so background
  // falls back to a URL match against this report.html URL.
  chrome.runtime.sendMessage({ type: 'registerDashboard' });

  // Force a sane title so Chrome's window-picker and tab-switcher show
  // "wearehere — dashboard" instead of the extension-ID URL during the
  // pre-paint window where the static <title> hasn't been picked up.
  document.title = 'wearehere — dashboard';

  // On refresh (or after the source tab has been closed), getFullReport
  // returns null. The Overview + Scoper tabs and the cross-session
  // blocks of Watchers are storage-driven and should still render —
  // only the per-tab Watchers/Terms detail blocks need a live report.
  // Pass a stub so per-site renderers fall through to noData
  // placeholders instead of bailing the whole dashboard.
  const safeReport = report || { site: '', url: '', tos: null };

  wireTabs();
  wireThemeSelect();
  renderOverview();
  renderWatchers(safeReport);
  renderScoper(safeReport);
  watchScoperStorage();
  watchVisitsStorage();
  maybeShowOnboarding();
}

// First-run overlay — shown once per install. Flag persists in
// chrome.storage.local so re-opening the dashboard later doesn't
// re-trigger it. No "show again" surface ships in v4.0.0.
function maybeShowOnboarding() {
  chrome.storage.local.get('dashboardOnboarded', ({ dashboardOnboarded }) => {
    if (dashboardOnboarded) return;
    const overlay = document.getElementById('onboarding');
    if (!overlay) return;
    overlay.hidden = false;
    const dismiss = document.getElementById('onb-dismiss');
    const done = () => {
      overlay.hidden = true;
      chrome.storage.local.set({ dashboardOnboarded: true });
    };
    dismiss.addEventListener('click', done, { once: true });
    // Esc also dismisses, mirroring native modal expectations.
    document.addEventListener('keydown', function escDismiss(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', escDismiss);
        done();
      }
    });
  });
}

function wireThemeSelect() {
  const btn = $('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = cur === 'light' ? 'dark' : 'light';
    chrome.storage.local.set({ theme: next });
    applyTheme(next);
  });
}

// Live-refresh overview + watchers cross-session blocks when a new visit
// gets snapshotted (tab close, domain change). Same pattern as scoper.
function watchVisitsStorage() {
  // Overview + Watchers aggregates render from windowSnapshots now, which
  // background recomputes hourly + post-append-when-stale. Listening on
  // the snapshot key keeps re-renders to once-per-recompute instead of
  // once-per-visit. visitHistory still drives renderRecentVisits + the
  // score trend, but those listen separately below.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    // Snapshot-driven blocks (hero + what-changed + who-follows-you)
    // re-render only when the snapshot key changes (~hourly + post-append
    // when stale). visitHistory updates do not retrigger these.
    if (changes[WINDOW_SNAPSHOTS_KEY]) {
      loadOverviewAggregates();
      loadWatchersAggregates();
    }
    // Per-visit detail (score trend dots, recent visits table) needs the
    // raw history.
    if (changes[VISIT_HISTORY_STORAGE_KEY]) {
      refreshRawVisitConsumers();
    }
  });
}

function refreshRawVisitConsumers() {
  loadOverviewRawVisits();
  loadWatchersRawVisits();
}

const VISIT_HISTORY_STORAGE_KEY = 'visitHistory';
const WINDOW_SNAPSHOTS_KEY = 'windowSnapshots';

// Live-refresh the scoper tab whenever storage changes. Sweeps run from
// the popup or the alarm write counters/history independently; the open
// dashboard tab needs to mirror those updates without a manual reload.
function watchScoperStorage() {
  const keys = ['cookieScopeCounters', 'cookieScopeTrust', 'cookieScopeSettings', 'cookieScopeHistory'];
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (keys.some((k) => k in changes)) {
      loadScoperState();
      renderCoverage();
    }
  });
}

// =========================================================================
// Tab switching
// =========================================================================

function wireTabs() {
  const tabs = document.querySelectorAll('.tab');
  const panels = document.querySelectorAll('.panel');
  const sel = $('tab-select');

  tabs.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.dataset.tab;
    opt.textContent = t.textContent;
    sel.appendChild(opt);
  });

  const activate = (name) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
    });
    panels.forEach((p) => {
      const on = p.id === `panel-${name}`;
      p.classList.toggle('active', on);
      p.hidden = !on;
    });
    sel.value = name;
  };

  tabs.forEach((t) => t.addEventListener('click', () => activate(t.dataset.tab)));
  sel.addEventListener('change', () => activate(sel.value));
}

// =========================================================================
// Overview tab — cross-session aggregates from visitHistory.
// Hero stats + recent watchers + score trend all derived from per-visit
// snapshots that background writes on tab close + domain change.
// =========================================================================

const WINDOW_OPTIONS = ['today', 'week', 'month', 'all'];
let overviewWindow = 'week';
let watchersWindow = 'week';

function renderOverview() {
  const panel = $('panel-overview');
  panel.innerHTML = `
    <div class="frame-title">this period</div>
    <div class="hero" id="overview-hero">
      <div class="cell"><div class="num" id="ov-sites">—</div><div class="lbl">sites visited</div></div>
      <div class="cell"><div class="num" id="ov-score">—</div><div class="lbl">avg score</div></div>
      <div class="cell"><div class="num" id="ov-watchers">—</div><div class="lbl">unique watchers</div></div>
      <div class="cell"><div class="num" id="ov-most-exposed">—</div><div class="lbl">most exposed</div></div>
    </div>
    <div class="callout" id="ov-callout"></div>
    <div class="callout impact" id="ov-impact" hidden></div>

    <div class="window-sel" id="ov-window" style="margin-top:14px"></div>

    <div class="frame-title">what changed</div>
    <div id="ov-changed"></div>

    <div class="frame-title">score trend</div>
    <div id="ov-trend"></div>
  `;

  renderWindowSelector('ov-window', overviewWindow, (w) => {
    overviewWindow = w;
    loadOverview();
  });
  loadOverview();
}

function renderWindowSelector(id, active, onChange) {
  const el = $(id);
  const draw = (cur) => {
    el.innerHTML = `<span class="lbl">window:</span>` + WINDOW_OPTIONS
      .map((w) => `<span class="opt${w === cur ? ' active' : ''}" data-w="${w}">${w === 'all' ? 'all time' : w}</span>`)
      .join('');
    el.querySelectorAll('.opt').forEach((opt) => {
      opt.onclick = () => {
        const w = opt.dataset.w;
        if (w === cur) return;
        draw(w);
        // Guard onChange: if it throws synchronously the UI would lie
        // (active class moved, data still on the previous window).
        // Repaint the old selection on failure.
        try { onChange(w); }
        catch (e) {
          console.warn('[window-sel] onChange failed; rolling back active state', e);
          draw(cur);
        }
      };
    });
  };
  draw(active);
}

function loadOverview() {
  loadOverviewAggregates();
  loadOverviewRawVisits();
}

function loadOverviewAggregates() {
  chrome.runtime.sendMessage({ type: 'snapshots:get-window', window: overviewWindow }, (resp) => {
    const { cur, prev } = resp || { cur: null, prev: null };
    renderOverviewHero(cur);
    renderWhatChanged(cur, prev);
  });
  chrome.runtime.sendMessage({ type: 'impact:get-window', window: overviewWindow }, (impact) => {
    renderImpactLine(impact);
  });
}

function renderImpactLine(impact) {
  const el = $('ov-impact');
  if (!el) return;
  if (!impact || (impact.tightened === 0 && impact.demotions === 0)) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  // Tell the story, not the mechanics: "this <window>, wearehere did X".
  // Hide demotion count when zero (sites with only first-party caps).
  const win = overviewWindow === 'all' ? 'all time' : `this ${overviewWindow}`;
  const cookieClause = impact.tightened
    ? `shortened ${impact.tightened.toLocaleString()} cookie${impact.tightened === 1 ? '' : 's'}`
    : '';
  const demoteClause = impact.demotions
    ? `${cookieClause ? ' and ' : ''}demoted ${impact.demotions.toLocaleString()} tracker${impact.demotions === 1 ? '' : 's'} to session-only`
    : '';
  el.hidden = false;
  el.innerHTML = `${win}: wearehere ${escapeText(cookieClause + demoteClause)} so they can't recognise you tomorrow.`;
}

function loadOverviewRawVisits() {
  chrome.runtime.sendMessage({ type: 'visits:get', window: overviewWindow }, (visits) => {
    renderScoreTrend(Array.isArray(visits) ? visits : []);
  });
}

function renderOverviewHero(snap) {
  if (!snap || !snap.visitsN) {
    $('ov-sites').textContent = '0';
    $('ov-score').textContent = '—';
    $('ov-watchers').textContent = '0';
    $('ov-most-exposed').textContent = '—';
    $('ov-callout').innerHTML = `<span class="dim">no visits in this window yet — keep browsing and come back.</span>`;
    return;
  }

  // Most-exposed shifts from "site with highest single-visit score" to
  // "site with highest average score across the window". Average is a
  // truer read of consistent exposure; the previous max-score variant
  // could be biased by a single outlier visit.
  const ranked = Object.entries(snap.avgScoreBySite || {})
    .map(([etld1, avg]) => ({ etld1, avg }))
    .sort((a, b) => (b.avg || 0) - (a.avg || 0));
  const mostExposed = ranked[0];

  $('ov-sites').textContent = (snap.sites || []).length.toLocaleString();
  $('ov-score').textContent = snap.avgScore;
  $('ov-watchers').textContent = Object.keys(snap.watchers || {}).length.toLocaleString();
  $('ov-most-exposed').textContent = mostExposed ? mostExposed.etld1 : '—';

  const top3 = ranked.slice(0, 3).map((v) => v.etld1).filter(Boolean);
  $('ov-callout').innerHTML = top3.length
    ? `most-watched: ${top3.map((s) => `<strong>${escapeText(s)}</strong>`).join(' · ')}`
    : '';
}

// What-changed event log: diff this-window vs prior-window of equal
// length. Aggregates come precomputed from windowSnapshots (background),
// so this is now a pure transform: pair of Window objects → typed events.
function renderWhatChanged(cur, prev) {
  const el = $('ov-changed');

  if (overviewWindow === 'all') {
    el.innerHTML = `<div class="placeholder"><div>diffs need a bounded window — pick today / week / month.</div></div>`;
    return;
  }
  if (!cur || !prev) {
    el.innerHTML = `<div class="placeholder"><div>no snapshot yet — keep browsing and come back.</div></div>`;
    return;
  }

  const events = diffAggregates(cur, prev);
  if (events.length === 0) {
    el.innerHTML = `<div class="placeholder"><div>no notable changes vs the prior ${escapeText(overviewWindow)}.</div></div>`;
    return;
  }
  el.innerHTML = events.slice(0, 20).map((e) => `
    <div class="event">
      <span class="event-icon ${e.cls}">${e.icon}</span>
      <span class="event-kind">${escapeText(e.kind)}</span>
      <span class="event-text">${e.text}</span>
    </div>
  `).join('');
}

function diffAggregates(cur, prev) {
  const events = [];

  // --- new site · in cur, not in prev ---
  const sitesPrev = new Set(prev.sites || []);
  for (const s of (cur.sites || [])) {
    if (!sitesPrev.has(s)) events.push({ cls: 'warn', icon: '⊕', kind: 'new site', text: `first visit to <strong>${escapeText(s)}</strong>` });
  }

  // --- watcher reach changes (new / gone / grew / shrank) ---
  const reachCur = cur.reachPct || {};
  const reachPrev = prev.reachPct || {};
  const watchersCur = cur.watchers || {};
  const allW = new Set([...Object.keys(reachCur), ...Object.keys(reachPrev)]);
  for (const w of allW) {
    const a = reachPrev[w] || 0;
    const b = reachCur[w] || 0;
    // "new watcher" requires ≥2 visits seeing it in cur, to suppress
    // one-off noise. snap.watchers[w].hits == visits-seen for this watcher.
    if (a === 0 && b >= 1 && (watchersCur[w] && watchersCur[w].hits >= 2)) {
      events.push({ cls: 'warn', icon: '↗', kind: 'new watcher', text: `<strong>${escapeText(w)}</strong> first seen this window` });
    } else if (b === 0 && a >= 1) {
      events.push({ cls: 'ok', icon: '↘', kind: 'watcher gone', text: `<strong>${escapeText(w)}</strong> not seen this window` });
    } else if (b - a >= 10) {
      events.push({ cls: 'warn', icon: '↗', kind: 'reach grew', text: `<strong>${escapeText(w)}</strong> reach ${a}% → ${b}%` });
    } else if (a - b >= 10) {
      events.push({ cls: 'ok', icon: '↘', kind: 'reach shrank', text: `<strong>${escapeText(w)}</strong> reach ${a}% → ${b}%` });
    }
  }

  // --- per-site avg score deltas ---
  const aCur = cur.avgScoreBySite || {};
  const aPrev = prev.avgScoreBySite || {};
  for (const s of Object.keys(aCur)) {
    if (aPrev[s] != null) {
      const delta = aCur[s] - aPrev[s];
      if (delta <= -5) events.push({ cls: 'ok', icon: '↘', kind: 'score improved', text: `<strong>${escapeText(s)}</strong> ${aPrev[s]} → ${aCur[s]}` });
      else if (delta >= 5) events.push({ cls: 'warn', icon: '↗', kind: 'score worsened', text: `<strong>${escapeText(s)}</strong> ${aPrev[s]} → ${aCur[s]}` });
    }
  }

  // --- cookies grew/shrank · per-site third-party count delta (≥10) ---
  const latestCur = cur.latestBySite || {};
  const latestPrev = prev.latestBySite || {};
  for (const s of Object.keys(latestCur)) {
    const a = (latestPrev[s] && latestPrev[s].cookieCount) || 0;
    const b = latestCur[s].cookieCount || 0;
    if (b - a >= 10) {
      events.push({ cls: 'warn', icon: '↗', kind: 'cookies grew', text: `<strong>${escapeText(s)}</strong> ${a} → ${b} third-party cookies` });
    } else if (a - b >= 10) {
      events.push({ cls: 'ok', icon: '↘', kind: 'cookies shrank', text: `<strong>${escapeText(s)}</strong> ${a} → ${b} third-party cookies` });
    }
  }

  // --- sweep impact · per-site scoper-tightened delta (≥5) ---
  for (const s of Object.keys(latestCur)) {
    const a = (latestPrev[s] && latestPrev[s].scoperTightened) || 0;
    const b = latestCur[s].scoperTightened || 0;
    if (b - a >= 5) {
      events.push({ cls: 'ok', icon: '✂', kind: 'sweep impact', text: `<strong>${escapeText(s)}</strong> +${b - a} cookies tightened by scoper` });
    }
  }

  // --- new broker · ≥2 hits in cur, absent in prev ---
  const brokersPrev = new Set(Object.keys(prev.brokers || {}));
  for (const k of Object.keys(cur.brokers || {})) {
    const b = cur.brokers[k];
    if (!brokersPrev.has(k) && b.hits >= 2) {
      events.push({ cls: 'warn', icon: '⊕', kind: 'new broker', text: `<strong>${escapeText(b.name)}</strong> first seen this window` });
    }
  }

  return events;
}

function renderRecentVisits(visits) {
  const el = $('w-recent');
  if (visits.length === 0) {
    el.innerHTML = `<div class="placeholder"><div>no recent visits.</div></div>`;
    return;
  }
  // Show one row per unique site, with most-recent visit's data.
  const seen = new Set();
  const rows = [];
  for (const v of visits) {
    if (!v.etld1 || seen.has(v.etld1)) continue;
    seen.add(v.etld1);
    rows.push(v);
    if (rows.length >= 20) break;
  }
  // Mechanism column — short words instead of glyphs. Only the ones that
  // fired show up bright; the rest are dimmed so the row still reads as
  // a 5-slot picture but the words carry the meaning.
  const MECH_LABELS = [
    { k: 'cookies',  l: 'cookies' },
    { k: 'pixels',   l: 'pixels' },
    { k: 'deviceId', l: 'device-id' },
    { k: 'typing',   l: 'typing' },
    { k: 'clicks',   l: 'clicks' },
  ];
  const mechCell = (mech) => {
    const m = mech || {};
    const fired = MECH_LABELS
      .filter(({ k }) => (m[k] || 0) > 0)
      .map(({ l }) => `<span class="mech-on">${l}</span>`);
    return fired.length
      ? `<span class="mech-words">${fired.join(' · ')}</span>`
      : `<span class="dim">none</span>`;
  };

  el.innerHTML = `
    <table class="table">
      <thead><tr><th>site</th><th>score</th><th>watchers</th><th>via</th><th>terms</th><th>when</th></tr></thead>
      <tbody>
        ${rows.map((v) => {
          const topW = (v.watchers || []).slice(0, 2).map(escapeText).join(', ');
          const more = (v.watchers || []).length > 2 ? ` <span class="dim">+${v.watchers.length - 2}</span>` : '';
          const tosCell = v.tosScore == null
            ? '<span class="dim">—</span>'
            : v.tosScore >= 60 ? `<span class="bad">${v.tosScore} [!]</span>`
            : v.tosScore >= 30 ? `<span class="warn">${v.tosScore} [!]</span>`
            : `<span class="ok">${v.tosScore} ✓</span>`;
          return `<tr>
            <td>${escapeText(v.etld1)}</td>
            <td class="num">${v.score}</td>
            <td>${topW || '<span class="dim">none</span>'}${more}</td>
            <td>${mechCell(v.mechanisms)}</td>
            <td>${tosCell}</td>
            <td><span class="dim">${escapeText(relativeTimeShort(v.at))}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renderScoreTrend(visits) {
  const el = $('ov-trend');
  if (visits.length < 2) {
    el.innerHTML = `<div class="placeholder"><div>need at least 2 visits to draw a trend.</div></div>`;
    return;
  }
  // Order chronologically, oldest first.
  const series = visits.slice().sort((a, b) => a.at - b.at);

  // Generous left gutter for the Y-axis labels (0 / 30 / 60 / 100).
  // Tier dividers at 30 (fair/mixed) and 60 (mixed/hostile) match the
  // scoring vocabulary used elsewhere in the dashboard.
  const W = 720, H = 180, PL = 30, PR = 12, PT = 14, PB = 24;
  const plotW = W - PL - PR;
  const plotH = H - PT - PB;
  const minAt = series[0].at, maxAt = series[series.length - 1].at;
  const span = Math.max(1, maxAt - minAt);

  const xFor = (at) => PL + ((at - minAt) / span) * plotW;
  const yFor = (score) => PT + (1 - (score || 0) / 100) * plotH;

  const points = series.map((v) => `${xFor(v.at).toFixed(1)},${yFor(v.score).toFixed(1)}`).join(' ');

  const dotFor = (v) => {
    const s = v.score || 0;
    const cls = s >= 60 ? 'bad' : s >= 30 ? 'warn' : 'ok';
    const tip = `${v.etld1 || 'unknown'} · score ${s} · ${relativeTimeShort(v.at)}`;
    return `<circle class="trend-dot ${cls}" cx="${xFor(v.at).toFixed(1)}" cy="${yFor(v.score).toFixed(1)}" r="3"><title>${escapeText(tip)}</title></circle>`;
  };

  // Friendly time axis: first label, midpoint, last.
  const midAt = minAt + span / 2;
  const xLabels = [
    { x: PL, label: relativeTimeShort(minAt), anchor: 'start' },
    { x: PL + plotW / 2, label: relativeTimeShort(midAt), anchor: 'middle' },
    { x: PL + plotW, label: relativeTimeShort(maxAt), anchor: 'end' },
  ];

  const yTicks = [
    { v: 0,   y: yFor(0)   },
    { v: 30,  y: yFor(30)  },
    { v: 60,  y: yFor(60)  },
    { v: 100, y: yFor(100) },
  ];

  const scores = series.map((v) => v.score || 0);
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const avgCls = avg >= 60 ? 'bad' : avg >= 30 ? 'warn' : 'ok';

  el.innerHTML = `
    <div class="trend-caption dim">score over time · each dot is one visit · lower is better</div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="trend-svg" role="img" aria-label="score over time">
      <!-- Tier bands -->
      <rect x="${PL}" y="${yFor(100)}" width="${plotW}" height="${yFor(60) - yFor(100)}" class="trend-band ok"/>
      <rect x="${PL}" y="${yFor(60)}"  width="${plotW}" height="${yFor(30) - yFor(60)}"  class="trend-band warn"/>
      <rect x="${PL}" y="${yFor(30)}"  width="${plotW}" height="${yFor(0)  - yFor(30)}"  class="trend-band bad"/>

      <!-- Y-axis grid + labels -->
      ${yTicks.map((t) => `
        <line x1="${PL}" y1="${t.y.toFixed(1)}" x2="${W - PR}" y2="${t.y.toFixed(1)}" class="trend-grid"/>
        <text x="${PL - 6}" y="${(t.y + 3).toFixed(1)}" text-anchor="end" class="trend-axis">${t.v}</text>
      `).join('')}

      <!-- Series line + dots -->
      <polyline class="trend-line" points="${points}"/>
      ${series.map(dotFor).join('')}

      <!-- X-axis time labels -->
      ${xLabels.map((l) => `<text x="${l.x.toFixed(1)}" y="${H - 6}" text-anchor="${l.anchor}" class="trend-axis">${escapeText(l.label)}</text>`).join('')}
    </svg>
    <div class="trend-legend">
      <span class="dim">${series.length} visits</span>
      <span class="dim">·</span>
      <span class="dim">avg <span class="${avgCls}">${avg}</span></span>
      <span class="dim">·</span>
      <span class="dim">range ${Math.min(...scores)} → ${Math.max(...scores)}</span>
      <span class="dim" style="margin-left:auto">
        <span class="ok">▮</span> fair
        <span class="warn">▮</span> mixed
        <span class="bad">▮</span> hostile
      </span>
    </div>
  `;
}

// =========================================================================
// Watchers tab — cross-site persistence + per-site Terms drill-in
// Hero / Who follows you / Recent visits are storage-dependent placeholders.
// Terms block renders from the CURRENT TAB's report.tos (real data today).
// =========================================================================

// Cache the per-tab reports we fetch on selector change so back-and-forth
// switching doesn't refetch the same data. Keyed by tabId.
const tabReportCache = new Map();

function renderWatchers(report) {
  const panel = $('panel-watchers');
  tabReportCache.set(tabId, report);
  const currentSite = report.site || '';
  const siteOpt = `<option value="${tabId}">${escapeText(currentSite)}</option>`;

  panel.innerHTML = `
    <div class="frame-title">watchers — who follows you across the web</div>
    <div class="hero" id="watchers-hero">
      <div class="cell"><div class="num" id="w-sites">—</div><div class="lbl">sites visited</div></div>
      <div class="cell"><div class="num" id="w-contacts">—</div><div class="lbl">hidden contacts</div></div>
      <div class="cell"><div class="num" id="w-unique">—</div><div class="lbl">unique watchers</div></div>
      <div class="cell"><div class="num" id="w-amp">—</div><div class="lbl">avg per visit</div></div>
    </div>

    <div class="window-sel" id="w-window" style="margin-top:14px"></div>

    <div class="frame-title">who follows you</div>
    <div id="w-who-summary" class="dim" style="font-size:11px;margin-bottom:8px"></div>
    <div id="w-who"></div>

    <div class="frame-title with-sel">
      <span>recent visits</span>
      <button class="btn-mini" id="clear-visits" type="button" title="erase the visit-history ring buffer">[ clear history ]</button>
    </div>
    <div id="w-recent"></div>

    <div class="dig-deeper">// dig deeper · per site</div>

    <div class="frame-title with-sel">
      <span>watchers ·</span>
      <select class="site-sel" id="watcher-site-sel">${siteOpt}</select>
    </div>
    <div id="watcher-detail-block">${renderWatcherDetail(report)}</div>

    <div class="frame-title with-sel">
      <span>terms ·</span>
      <select class="site-sel" id="terms-site-sel">${siteOpt}</select>
    </div>
    <div id="terms-block">${renderTermsBlock(report)}</div>
  `;

  wireSiteSelectors();
  populateSiteSelectors();
  wireClearVisits();

  renderWindowSelector('w-window', watchersWindow, (w) => {
    watchersWindow = w;
    loadCrossSiteWatchers();
  });
  loadCrossSiteWatchers();
}

function wireClearVisits() {
  const btn = $('clear-visits');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (!confirm('Erase the visit-history ring buffer? This wipes the data behind Overview + Watchers cross-session blocks. Cookie scoper history is kept.')) return;
    btn.disabled = true;
    btn.textContent = '[ clearing… ]';
    chrome.runtime.sendMessage({ type: 'visits:clear' }, () => {
      btn.disabled = false;
      btn.textContent = '[ cleared ✓ ]';
      setTimeout(() => { btn.textContent = '[ clear history ]'; }, 1400);
      // The visitHistory storage change will fan out and re-render
      // Overview + cross-session watchers via watchVisitsStorage().
    });
  });
}

function loadCrossSiteWatchers() {
  loadWatchersAggregates();
  loadWatchersRawVisits();
}

function loadWatchersAggregates() {
  chrome.runtime.sendMessage({ type: 'snapshots:get-window', window: watchersWindow }, (resp) => {
    const { cur } = resp || { cur: null };
    renderWatchersHero(cur);
    renderWhoFollowsYou(cur);
  });
}

function loadWatchersRawVisits() {
  chrome.runtime.sendMessage({ type: 'visits:get', window: watchersWindow }, (visits) => {
    renderRecentVisits(Array.isArray(visits) ? visits : []);
  });
}

function renderWatchersHero(snap) {
  if (!snap || !snap.visitsN) {
    $('w-sites').textContent = '0';
    $('w-contacts').textContent = '0';
    $('w-unique').textContent = '0';
    $('w-amp').textContent = '—';
    return;
  }
  const unique = Object.keys(snap.watchers || {}).length;
  const amp = (snap.contacts / snap.visitsN).toFixed(1);
  $('w-sites').textContent = (snap.sites || []).length.toLocaleString();
  $('w-contacts').textContent = snap.contacts.toLocaleString();
  $('w-unique').textContent = unique.toLocaleString();
  $('w-amp').textContent = `${amp}×`;
}

function renderWhoFollowsYou(snap) {
  const el = $('w-who');
  if (!snap || !snap.visitsN) {
    el.innerHTML = `<div class="placeholder"><div>no visits yet — once you've browsed, this fills in.</div></div>`;
    return;
  }

  const watchers = snap.watchers || {};
  const reach = snap.reachPct || {};
  const ranked = Object.entries(watchers)
    .map(([k, w]) => ({ ...w, pct: reach[k] || 0 }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12);

  if (ranked.length === 0) {
    el.innerHTML = `<div class="placeholder"><div>no named watchers in this window.</div></div>`;
    return;
  }

  const maxPct = Math.max(1, ranked[0].pct);

  // Per-company mechanisms we can attribute: cookies, pixels, clicks,
  // device-id. (device-id resolved via inject.js stack-walk → caller
  // host → company via cooked-items map; typing remains site-level
  // because detect-silent.js measures form-field exposure, not
  // per-script keystroke listeners.)
  const MECH_ORDER = ['cookies', 'pixels', 'clicks', 'deviceId'];
  const MECH_LABEL = { cookies: 'cookies', pixels: 'pixels', clicks: 'clicks', deviceId: 'device-id' };
  const mechLine = (m) => {
    const parts = MECH_ORDER.filter((k) => (m[k] || 0) > 0).map((k) => MECH_LABEL[k]);
    return parts.length ? parts.join(' · ') : 'presence only';
  };

  el.innerHTML = ranked.map((c) => `
    <div class="reach-row">
      <div class="reach-line">
        <span class="reach-pct">${c.pct}%</span>
        <span class="bar" style="width:${Math.round((c.pct / maxPct) * 60)}%"></span>
        <span class="reach-name">${escapeText(c.name)}</span>
        <span class="dim">seen on ${c.hits} of ${snap.visitsN} visit${snap.visitsN === 1 ? '' : 's'}</span>
      </div>
      <div class="reach-mech"><span class="dim">via</span> ${escapeText(mechLine(c.mech))}</div>
    </div>
  `).join('');

  // Site-level summary: form-field exposure (typing). Other mechanisms
  // are now per-company. Fingerprint reads from unattributed scripts
  // (caller host not in the cooked-items company map) are silently
  // dropped — the site-level "typing" line is what's left to surface.
  const summary = $('w-who-summary');
  if (summary) {
    const { fields = 0, visits: vsig = 0 } = snap.typing || {};
    summary.innerHTML = fields
      ? `also: ${fields} form field${fields === 1 ? '' : 's'} exposed across ${vsig} visit${vsig === 1 ? '' : 's'} <span title="form-field exposure can't be attributed to a single company — listeners aren't observable per-script">[?]</span>`
      : '';
  }
}

let siteSelectorsWired = false;

function wireSiteSelectors() {
  // Idempotency guard — wiring runs once per dashboard lifetime. Today
  // renderWatchers fires only at init, but a future "reload dashboard"
  // path would re-call this and leak duplicate chrome.tabs listeners.
  if (siteSelectorsWired) return;
  siteSelectorsWired = true;
  const watcherSel = $('watcher-site-sel');
  const termsSel = $('terms-site-sel');
  const noData = (label) => `<div class="placeholder"><div>no live capture for ${escapeText(label)} yet — open or refresh that tab and try again.</div></div>`;

  watcherSel.addEventListener('change', () => {
    const opt = watcherSel.options[watcherSel.selectedIndex];
    fetchTabReport(parseInt(watcherSel.value, 10)).then((r) => {
      $('watcher-detail-block').innerHTML = r ? renderWatcherDetail(r) : noData(opt?.textContent || 'this tab');
    });
  });
  termsSel.addEventListener('change', () => {
    const opt = termsSel.options[termsSel.selectedIndex];
    fetchTabReport(parseInt(termsSel.value, 10)).then((r) => {
      $('terms-block').innerHTML = r ? renderTermsBlock(r) : noData(opt?.textContent || 'this tab');
    });
  });

  // Keep the option list fresh via lifecycle events only.
  // mousedown/focus refresh races with the user's click: fetching
  // getOpenTabs while the dropdown is open returns labels with newer
  // watcher counts → innerHTML swap → dropdown closes mid-click →
  // selection lost. chrome.tabs.{onCreated,onRemoved,onUpdated} below
  // already cover all the cases the mousedown refresh was guarding.
  const refresh = () => populateSiteSelectors({ preserveSelection: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  // Also react to tab open/close/navigation churn while the dashboard
  // is in the foreground — every chrome.tabs lifecycle event in the
  // background SW triggers a tabData mutation we'd want reflected.
  chrome.tabs.onCreated.addListener(() => refresh());
  chrome.tabs.onRemoved.addListener((closedId) => {
    // Drop the cached report so we don't keep showing data from a tab
    // the user closed if their selection lands back on it later.
    tabReportCache.delete(closedId);
    refresh();
  });
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.url || info.status === 'complete') refresh();
  });
}

function populateSiteSelectors(opts) {
  chrome.runtime.sendMessage({ type: 'getOpenTabs' }, (tabs) => {
    if (!Array.isArray(tabs) || tabs.length === 0) return;
    const watcherSel = $('watcher-site-sel');
    const termsSel = $('terms-site-sel');
    const preserve = opts && opts.preserveSelection;

    const labelFor = (t) => {
      if (!t.hasReport) return `${t.domain} · (no scan)`;
      if (typeof t.watcherCount === 'number') {
        return `${t.domain} · ${t.watcherCount} watcher${t.watcherCount === 1 ? '' : 's'}`;
      }
      return t.domain;
    };
    const sorted = tabs.filter((t) => t.domain).sort((a, b) => a.domain.localeCompare(b.domain));
    const availableIds = new Set(sorted.map((t) => String(t.id)));
    // If the previously-selected tab disappeared (closed or navigated
    // away), fall back to the dashboard's source tab when it's still
    // open, else the first available. Otherwise the dropdown would
    // render blank — the value would be a tabId no <option> matches.
    const fallback = availableIds.has(String(tabId))
      ? String(tabId)
      : (sorted[0] ? String(sorted[0].id) : '');
    const resolveVal = (current) => (preserve && current && availableIds.has(current))
      ? current
      : fallback;

    const watcherPrev = watcherSel.value;
    const termsPrev = termsSel.value;
    const watcherVal = resolveVal(watcherPrev);
    const termsVal = resolveVal(termsPrev);

    const buildOptions = (selVal) => sorted
      .map((t) => `<option value="${t.id}"${String(t.id) === selVal ? ' selected' : ''}>${escapeText(labelFor(t))}</option>`)
      .join('');

    const watcherOptions = buildOptions(watcherVal);
    const termsOptions = buildOptions(termsVal);

    // Skip the innerHTML swap when the markup is unchanged. Replacing
    // options while the dropdown is open closes the menu under the
    // user's click, so their selection never fires `change`. The
    // `selected` attribute already tracks the correct value.
    if (watcherSel.innerHTML !== watcherOptions) {
      watcherSel.innerHTML = watcherOptions;
      watcherSel.value = watcherVal;
    }
    if (termsSel.innerHTML !== termsOptions) {
      termsSel.innerHTML = termsOptions;
      termsSel.value = termsVal;
    }

    // If the user's selection was forcibly moved (their tab closed),
    // re-render the detail block so we don't keep showing stale data
    // from the closed tab. Synthetic `change` is the existing handler
    // path — keeps fetchTabReport + cache + no-data fallback in one
    // place.
    if (watcherPrev && watcherPrev !== watcherVal) {
      watcherSel.dispatchEvent(new Event('change'));
    }
    if (termsPrev && termsPrev !== termsVal) {
      termsSel.dispatchEvent(new Event('change'));
    }
  });
}

function fetchTabReport(targetTabId) {
  if (!Number.isFinite(targetTabId)) return Promise.resolve(null);
  const cached = tabReportCache.get(targetTabId);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'getFullReport', tabId: targetTabId }, (r) => {
      if (r) tabReportCache.set(targetTabId, r);
      resolve(r || null);
    });
  });
}

function renderWatcherDetail(report) {
  const cookies = report.cookies || {};
  const trackers = report.trackers || {};
  const network = report.network || {};
  const fp = report.fingerprinting || {};
  const forms = report.forms || {};
  const links = report.linkTracking || {};

  // Mechanism counts (which fired, how many)
  const mechCounts = [];
  if ((cookies.snoops || 0) > 0) mechCounts.push({ name: 'cookies', n: cookies.snoops });
  const pixelsN = (trackers.pixels || 0) + (trackers.beacons || 0) + (trackers.hiddenIframes || 0);
  if (pixelsN > 0) mechCounts.push({ name: 'pixels', n: pixelsN });
  if ((fp.techniques || 0) > 0) mechCounts.push({ name: 'device-id', n: fp.techniques });
  if ((forms.fieldCount || 0) > 0) mechCounts.push({ name: 'typing', n: forms.fieldCount });
  if ((links.tracked || 0) > 0) mechCounts.push({ name: 'clicks', n: links.tracked });

  const brokers = Array.isArray(network.brokers) ? network.brokers : [];
  const companies = Array.isArray(trackers.companies) ? trackers.companies : [];

  if (mechCounts.length === 0 && companies.length === 0 && brokers.length === 0) {
    return `<div class="placeholder"><div>no watchers detected on this site ✓</div></div>`;
  }

  const mechLine = mechCounts.length
    ? `<div class="callout">how: ${mechCounts.map((m) => `<strong>${m.name}</strong> <span class="dim">${m.n}</span>`).join(' · ')}</div>`
    : '';

  // Top companies with via + purpose
  const companyRows = companies.slice(0, 12).map((c) => {
    const via = [];
    if (c.viaPixels) via.push(`pixels ${c.viaPixels}`);
    if (c.viaCookies) via.push(`cookies ${c.viaCookies}`);
    const viaText = via.length ? ` · ${via.join(' · ')}` : '';
    const purpose = c.purpose && c.purpose !== 'Unknown' ? c.purpose : '';
    return `
      <div class="event">
        <span class="event-icon">[·]</span>
        <span class="event-kind">${escapeText(c.name)}</span>
        <span class="event-text">${escapeText(purpose)}<span class="dim">${viaText}</span></span>
      </div>`;
  }).join('');

  const companyBlock = companies.length
    ? `<div class="block-sub">companies (${companies.length})</div>${companyRows}`
    : '';

  // Data brokers — call out separately, even if folded into companies
  const brokerRows = brokers.slice(0, 10).map((b) => `
    <div class="event">
      <span class="event-icon warn">[!]</span>
      <span class="event-kind">${escapeText(b.name || b.brokerName || 'broker')}</span>
      <span class="event-text">${(b.count || 0)} request${b.count === 1 ? '' : 's'}</span>
    </div>
  `).join('');

  const brokerBlock = brokers.length
    ? `<div class="block-sub">data brokers (${brokers.length})</div>${brokerRows}`
    : '';

  // Fingerprinting techniques detail
  const fpMethods = Array.isArray(fp.methods) ? fp.methods : [];
  const fpRows = fpMethods.slice(0, 8).map((m) => `
    <div class="event">
      <span class="event-icon">[·]</span>
      <span class="event-kind">${escapeText(m.technique || '')}</span>
      <span class="event-text"><span class="dim">${(m.apis || []).slice(0, 4).map(escapeText).join(', ')}${m.apis && m.apis.length > 4 ? ', …' : ''} · ${m.calls || 0} calls</span></span>
    </div>
  `).join('');

  const fpBlock = fpMethods.length
    ? `<div class="block-sub">device-id techniques (${fpMethods.length})</div>${fpRows}`
    : '';

  // Form fields watched
  const formBlock = (forms.fieldCount || 0) > 0
    ? `<div class="block-sub">typing</div>
       <div class="event">
         <span class="event-icon">[·]</span>
         <span class="event-text">${forms.fieldCount} form field${forms.fieldCount === 1 ? '' : 's'} watched${forms.trackerNames && forms.trackerNames.length ? ` · trackers: ${forms.trackerNames.slice(0,3).map(escapeText).join(', ')}` : ''}</span>
       </div>`
    : '';

  // Click tagging
  const clickBlock = (links.tracked || 0) > 0
    ? `<div class="block-sub">clicks</div>
       <div class="event">
         <span class="event-icon">[·]</span>
         <span class="event-text">${links.tracked} of ${links.total} links tagged · ${links.percentage || 0}%</span>
       </div>`
    : '';

  // Stored device IDs — identifier strings sitting in localStorage /
  // sessionStorage. Distinct from device-id fingerprinting: that reads
  // device surfaces, this writes persistent IDs back to the device.
  // Popup deliberately doesn't surface this (mechanism set is locked at
  // 5); the dashboard's detail view is where it belongs.
  const local = report.localData || {};
  const flaggedKeys = Array.isArray(local.flaggedKeys) ? local.flaggedKeys : [];
  const storedBlock = (local.suspicious || 0) > 0
    ? `<div class="block-sub">stored identifiers (${local.suspicious})</div>
       ${flaggedKeys.slice(0, 8).map((k) => `
         <div class="event">
           <span class="event-icon">[·]</span>
           <span class="event-kind">${escapeText(k.key || '')}</span>
           <span class="event-text"><span class="dim">${(k.flags || []).slice(0, 3).map(escapeText).join(', ')}</span></span>
         </div>
       `).join('')}`
    : '';

  return `
    ${mechLine}
    ${companyBlock}
    ${brokerBlock}
    ${fpBlock}
    ${formBlock}
    ${clickBlock}
    ${storedBlock}
  `;
}

function renderTermsBlock(report) {
  const tos = report.tos;
  if (!tos) {
    return `<div class="placeholder">terms scan hasn't run for this site yet — reload the tab to trigger one.</div>`;
  }
  if (tos.loading) {
    return `<div class="placeholder">analyzing terms… open the site's privacy policy directly and revisit.</div>`;
  }
  if (!tos.found) {
    return `<div class="placeholder">couldn't find a terms page for this site.</div>`;
  }
  const score = tos.score || 0;
  const verdict = score >= 60 ? 'hostile' : score >= 30 ? 'mixed' : 'reasonable';
  const verdictCls = score >= 60 ? 'bad' : score >= 30 ? 'warn' : 'ok';

  // Flagged categories — each has { type, label, count }. The pattern
  // categories (data-sharing / surveillance / retention / law-enforcement
  // / rights-erosion / unilateral-control) are all "concerning"; tier
  // their icon by hit count so heavy offenders surface visually.
  const flagged = Array.isArray(tos.flagged) ? tos.flagged : [];
  const rows = flagged.length
    ? flagged
        .slice()
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .map((f) => {
          const heavy = (f.count || 0) >= 5;
          const cls = heavy ? 'bad' : 'warn';
          return `
            <div class="event">
              <span class="event-icon ${cls}">[!]</span>
              <span class="event-kind">${escapeText(f.label || f.type || 'clause')}</span>
              <span class="event-text"><span class="dim">${f.count || 0} match${f.count === 1 ? '' : 'es'} · ${escapeText(f.type || '')}</span></span>
            </div>`;
        })
        .join('')
    : `<div class="placeholder"><div>no specific clauses flagged for this site.</div></div>`;

  // Surface privacy/terms page sources when present so the user can
  // verify (or jump straight to) the source ToS.
  const sources = [];
  if (tos.privacy && tos.privacy.score != null) sources.push(`privacy ${tos.privacy.score}`);
  if (tos.terms && tos.terms.score != null) sources.push(`terms ${tos.terms.score}`);
  const sourceLine = sources.length
    ? `<div class="callout">scored from: ${sources.join(' · ')}</div>`
    : '';

  return `
    <div class="score-line">
      <span class="score-num">${score} / 100</span>
      <span class="${verdictCls}">[${verdict}]</span>
    </div>
    ${sourceLine}
    ${rows}
  `;
}

// =========================================================================
// Cookie scoper tab — wired to chrome.storage.local via scoper:* messages.
// =========================================================================

const PERIOD_CHOICES = [
  { min: 15, label: '15min' },
  { min: 60, label: 'hourly' },
  { min: 240, label: '4hr' },
  { min: 720, label: '12hr' },
];

function renderScoper(_report) {
  const panel = $('panel-scoper');
  panel.innerHTML = `
    <div class="frame-title">cookie scoper</div>
    <div class="hero" id="scoper-hero">
      <div class="cell"><div class="num" id="scoper-tightened">—</div><div class="lbl">tightened (lifetime)</div></div>
      <div class="cell"><div class="num" id="scoper-killed">—</div><div class="lbl">trackers killed (lifetime)</div></div>
      <div class="cell"><div class="num" id="scoper-sweeps">—</div><div class="lbl">sweeps run (lifetime)</div></div>
      <div class="cell"><div class="num" id="scoper-last">never</div><div class="lbl">last sweep</div></div>
    </div>

    <div class="frame-title">cookies in your browser</div>
    <div id="scoper-coverage" class="placeholder"><div>counting cookies…</div></div>

    <div class="frame-title">trusted sites</div>
    <div id="scoper-trust"></div>

    <div class="frame-title">settings · sweep period</div>
    <div class="window-sel" id="scoper-period"></div>
    <div id="scoper-period-status" class="callout"></div>

    <div class="frame-title">recent activity</div>
    <div id="scoper-history"></div>
  `;

  loadScoperState();
  renderCoverage();
}

function loadScoperState() {
  chrome.runtime.sendMessage({ type: 'scoper:get-state' }, (state) => {
    state = state || {};
    renderScoperHero(state);
    renderTrustList(state.cookieScopeTrust || {});
    renderPeriodRadio(state.cookieScopeSettings || {});
    renderHistoryList(state.cookieScopeHistory || []);
  });
}

function renderScoperHero(state) {
  const stats = state.cookieScopeCounters || {};
  $('scoper-tightened').textContent = (stats.tightened || 0).toLocaleString();
  $('scoper-killed').textContent = (stats.demotions || 0).toLocaleString();
  $('scoper-sweeps').textContent = (stats.sweeps || 0).toLocaleString();
  $('scoper-last').textContent = stats.lastSweep ? relativeTimeShort(stats.lastSweep) : 'never';
}

function relativeTimeShort(ms) {
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  return Math.floor(diff / 86_400_000) + 'd ago';
}

function renderCoverage() {
  const el = $('scoper-coverage');
  chrome.cookies.getAll({}, (cookies) => {
    const expiry = { '<7d': 0, '<30d': 0, '<90d': 0, '1yr+': 0, session: 0 };
    const owners = {};
    const nowSec = Date.now() / 1000;
    for (const c of cookies || []) {
      if (c.session || !c.expirationDate) {
        expiry.session++;
      } else {
        const days = (c.expirationDate - nowSec) / 86400;
        if (days < 7) expiry['<7d']++;
        else if (days < 30) expiry['<30d']++;
        else if (days < 90) expiry['<90d']++;
        else expiry['1yr+']++;
      }
      const host = (c.domain || '').replace(/^\./, '').split('.').slice(-2).join('.');
      if (host) owners[host] = (owners[host] || 0) + 1;
    }
    const total = (cookies || []).length;
    const topOwners = Object.entries(owners).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxExpiry = Math.max(1, ...Object.values(expiry));
    const bar = (n, max) => `<span class="bar" style="width:${Math.round((n / max) * 60)}%"></span>`;

    // Coverage buckets need the scoper policy applied — fetch from background.
    chrome.runtime.sendMessage({ type: 'cookies:bucket' }, (cov) => {
      cov = cov || { capped: 0, trusted: 0, killOnClose: 0, total };
      const maxCov = Math.max(1, cov.capped, cov.trusted, cov.killOnClose);
      el.classList.remove('placeholder');
      el.innerHTML = `
        <div class="callout"><strong>${total.toLocaleString()}</strong> cookies in your browser right now</div>

        <div class="block-sub">coverage · what the scoper will do</div>
        <div class="bar-row"><span class="nval">${cov.capped}</span> ${bar(cov.capped, maxCov)} <span class="nlbl">capped (1p · 7d)</span></div>
        <div class="bar-row"><span class="nval">${cov.trusted}</span> ${bar(cov.trusted, maxCov)} <span class="nlbl">trusted (passing through)</span></div>
        <div class="bar-row"><span class="nval">${cov.killOnClose}</span> ${bar(cov.killOnClose, maxCov)} <span class="nlbl">tracker (demoted to session)</span></div>

        <div class="block-sub">by expiry</div>
        <div class="bar-row"><span class="nval">${expiry.session}</span> ${bar(expiry.session, maxExpiry)} <span class="nlbl">session</span></div>
        <div class="bar-row"><span class="nval">${expiry['<7d']}</span> ${bar(expiry['<7d'], maxExpiry)} <span class="nlbl">&lt; 7 days</span></div>
        <div class="bar-row"><span class="nval">${expiry['<30d']}</span> ${bar(expiry['<30d'], maxExpiry)} <span class="nlbl">&lt; 30 days</span></div>
        <div class="bar-row"><span class="nval">${expiry['<90d']}</span> ${bar(expiry['<90d'], maxExpiry)} <span class="nlbl">&lt; 90 days</span></div>
        <div class="bar-row"><span class="nval">${expiry['1yr+']}</span> ${bar(expiry['1yr+'], maxExpiry)} <span class="nlbl">90 days +</span></div>

        <div class="callout" style="margin-top:10px">top owners: ${topOwners.map(([h, n]) => `<strong>${escapeText(h)}</strong> (${n})`).join(' · ') || '—'}</div>
      `;
    });
  });
}

function renderTrustList(trust) {
  const el = $('scoper-trust');
  const entries = Object.entries(trust).sort((a, b) => (b[1].addedAt || 0) - (a[1].addedAt || 0));

  const addRow = `
    <div class="trust-add">
      <input type="text" id="trust-input" placeholder="example.com" autocomplete="off">
      <button class="btn-mini" id="trust-add-btn">[ add 30d ]</button>
    </div>
  `;

  if (entries.length === 0) {
    el.innerHTML = `${addRow}<div class="placeholder"><div>no trusted sites yet — trust a site to keep its cookies past 7 days.</div></div>`;
    wireTrustControls();
    return;
  }

  const rows = entries.map(([etld1, t]) => `
    <tr>
      <td>${escapeText(etld1)}</td>
      <td class="num">${t.capDays}d</td>
      <td>
        <button class="btn-mini" data-action="toggle" data-etld1="${escapeText(etld1)}" data-cap="${t.capDays === 30 ? 90 : 30}">[ ${t.capDays === 30 ? 'extend 90d' : 'shorten 30d'} ]</button>
        <button class="btn-mini" data-action="remove" data-etld1="${escapeText(etld1)}">[ remove ]</button>
      </td>
    </tr>
  `).join('');

  el.innerHTML = `
    ${addRow}
    <table class="table" style="margin-top:10px">
      <thead><tr><th>domain</th><th>cap</th><th>actions</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  wireTrustControls();
}

function wireTrustControls() {
  const addBtn = $('trust-add-btn');
  const input = $('trust-input');
  if (addBtn && input) {
    addBtn.onclick = () => {
      const v = (input.value || '').trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
      if (!v || !v.includes('.')) return;
      chrome.runtime.sendMessage({ type: 'scoper:set-trust', etld1: v, cap: 30 }, () => {
        input.value = '';
        loadScoperState();
      });
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') addBtn.click(); };
  }
  document.querySelectorAll('#scoper-trust [data-action]').forEach((btn) => {
    btn.onclick = () => {
      const etld1 = btn.dataset.etld1;
      const action = btn.dataset.action;
      const cap = action === 'remove' ? 0 : parseInt(btn.dataset.cap, 10);
      chrome.runtime.sendMessage({ type: 'scoper:set-trust', etld1, cap }, () => loadScoperState());
    };
  });
}

function renderPeriodRadio(settings) {
  const current = PERIOD_CHOICES.find((p) => p.min === settings.sweepPeriodMin) ? settings.sweepPeriodMin : 60;
  const el = $('scoper-period');
  el.innerHTML = `<span class="lbl">every</span>` + PERIOD_CHOICES
    .map((p) => `<span class="opt${p.min === current ? ' active' : ''}" data-min="${p.min}">${p.label}</span>`)
    .join('');
  el.querySelectorAll('.opt').forEach((opt) => {
    opt.onclick = () => {
      const min = parseInt(opt.dataset.min, 10);
      const status = $('scoper-period-status');
      // Flash a "saved" affirmation right next to the radio so the user
      // sees their choice actually persisted, not just the active dot
      // moving. After ~1.5s, fall back to the live alarm status line.
      if (status) {
        status.textContent = 'saved ✓ · applying…';
        status.classList.add('saved-flash');
      }
      chrome.runtime.sendMessage(
        { type: 'scoper:set-settings', settings: { sweepPeriodMin: min } },
        () => {
          loadScoperState();
          setTimeout(() => {
            if (status) status.classList.remove('saved-flash');
            renderAlarmStatus();
          }, 1500);
        }
      );
    };
  });
  renderAlarmStatus();
}

// Verifies the alarm registered in the SW matches the stored setting,
// and surfaces the next-fire ETA so the user can confirm the period
// actually applied (not just the radio dot moved).
function renderAlarmStatus() {
  const el = $('scoper-period-status');
  if (!el) return;
  chrome.runtime.sendMessage({ type: 'scoper:get-alarm' }, (a) => {
    if (!a) { el.textContent = 'no alarm registered'; return; }
    const periodLabel = (PERIOD_CHOICES.find((p) => p.min === a.periodInMinutes) || { label: a.periodInMinutes + 'min' }).label;
    const minsToNext = Math.max(0, Math.round((a.scheduledTime - Date.now()) / 60000));
    el.textContent = `active · every ${periodLabel} · next sweep in ~${minsToNext} min`;
  });
}

function renderHistoryList(history) {
  const el = $('scoper-history');
  if (!history.length) {
    el.innerHTML = `<div class="placeholder"><div>no sweeps yet — the first one fires shortly after install.</div></div>`;
    return;
  }
  el.innerHTML = history.slice(0, 20).map((h) => {
    const when = relativeTimeShort(h.at);
    return `
      <div class="event">
        <span class="event-icon ok">[ok]</span>
        <span class="event-kind">${escapeText(h.trigger)} · ${escapeText(when)}</span>
        <span class="event-text">scanned ${h.scanned} · rewrote ${h.rewrote}${h.demotions ? ` · demoted ${h.demotions}` : ''}</span>
      </div>`;
  }).join('');
}

// =========================================================================
// helpers
// =========================================================================

function placeholder(title, body) {
  return `
    <div class="placeholder">
      <div class="placeholder-title">${escapeText(title)}</div>
      <div>${escapeText(body)}</div>
    </div>
  `;
}

function escapeText(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
