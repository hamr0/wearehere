/**
 * report.js — Full-page dashboard for wearehere.
 * Sends { type: 'getFullReport' } to background.js and renders all 8 tabs.
 */

(function () {
  'use strict';

  let reportData = null;
  let activeTab = 'overview';
  let cookieSortCol = null;
  let cookieSortAsc = true;
  let networkSortCol = null;
  let networkSortAsc = true;
  let cookieFilter = '';

  // --- Init ---
  chrome.runtime.sendMessage({ type: 'getFullReport' }, (report) => {
    document.getElementById('loading').style.display = 'none';

    if (!report) {
      document.getElementById('empty').style.display = 'flex';
      return;
    }

    reportData = report;
    document.getElementById('report').style.display = 'block';
    document.getElementById('site-domain').textContent = report.site;

    initTabs();
    renderOverview();
    renderCookies();
    renderNetwork();
    renderTrackers();
    renderTerms();
    renderData();
    renderFingerprinting();
    renderForms();
  });

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
      });
    });
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

  // --- 1. Overview ---
  function renderOverview() {
    const panel = document.getElementById('panel-overview');
    panel.innerHTML = '';
    const v = reportData.verdict;
    const rc = riskColor(v.score);

    // Score display
    const scoreDiv = el('div', { className: 'score-display' });
    scoreDiv.appendChild(el('div', { className: 'score-number color-' + rc, textContent: v.score }));
    const meta = el('div', { className: 'score-meta' });
    meta.appendChild(el('div', { className: 'score-risk color-' + rc, textContent: v.risk }));
    meta.appendChild(el('div', { className: 'score-recommendation', textContent: v.recommendation }));
    scoreDiv.appendChild(meta);
    panel.appendChild(scoreDiv);

    // Risk bar
    const bar = el('div', { className: 'risk-bar' });
    const fill = el('div', { className: 'risk-bar-fill bg-' + rc });
    fill.style.width = v.score + '%';
    bar.appendChild(fill);
    panel.appendChild(bar);

    // Score breakdown by category
    panel.appendChild(el('div', { className: 'section-heading', textContent: 'Score Breakdown' }));
    const breakdownCard = el('div', { className: 'card' });
    const breakdowns = computeBreakdown();
    for (const b of breakdowns) {
      const row = el('div', { className: 'breakdown-row' });
      row.appendChild(el('span', { className: 'breakdown-label', textContent: b.label }));
      const track = el('div', { className: 'breakdown-bar-track' });
      const bfill = el('div', { className: 'breakdown-bar-fill bg-' + riskColor(b.points * 4) });
      bfill.style.width = (b.points > 0 ? Math.max((b.points / 25) * 100, 5) : 0) + '%';
      track.appendChild(bfill);
      row.appendChild(track);
      row.appendChild(el('span', { className: 'breakdown-value', textContent: '+' + b.points }));
      breakdownCard.appendChild(row);
    }
    panel.appendChild(breakdownCard);

    // Concerns
    if (v.concerns.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Concerns' }));
      const list = el('ul', { className: 'concerns-list' });
      for (const c of v.concerns) {
        const li = el('li');
        li.appendChild(el('span', { className: 'concern-dot' }));
        li.appendChild(document.createTextNode(c));
        list.appendChild(li);
      }
      panel.appendChild(list);
    }

    // Summary cards
    panel.appendChild(el('div', { className: 'section-heading mt-16', textContent: 'At a Glance' }));
    const grid = el('div', { className: 'summary-grid' });
    const r = reportData;

    grid.appendChild(summaryCard('Cookies', r.cookies.total, r.cookies.thirdParty + ' third-party'));
    grid.appendChild(summaryCard('Trackers', r.trackers.total, r.trackers.total > 0 ? 'hidden elements' : 'none found'));
    grid.appendChild(summaryCard('Fingerprinting', r.fingerprinting.techniques > 0 ? 'Active' : 'None', r.fingerprinting.techniques + ' technique' + (r.fingerprinting.techniques !== 1 ? 's' : '')));
    grid.appendChild(summaryCard('Pressure', r.pressure.score + '/100', r.pressure.tactics.length + ' tactic' + (r.pressure.tactics.length !== 1 ? 's' : '')));

    const tosLabel = r.tos.loading ? '...' : (!r.tos.found && r.tos.score === undefined) ? 'N/A' : r.tos.score + '/100';
    grid.appendChild(summaryCard('Terms', tosLabel, r.tos.loading ? 'loading' : r.tos.flagged ? r.tos.flagged.length + ' flagged' : 'not found'));
    grid.appendChild(summaryCard('Storage', r.localData.suspicious > 0 ? r.localData.suspicious + ' flagged' : 'Clean', r.localData.totalKeys + ' total keys'));
    grid.appendChild(summaryCard('Links Tracked', r.linkTracking.percentage + '%', r.linkTracking.tracked + ' of ' + r.linkTracking.total));

    const formFields = r.forms ? r.forms.fieldCount : 0;
    const formTrackers = r.forms ? r.forms.trackersWhileTyping : 0;
    grid.appendChild(summaryCard('Forms', formFields + ' field' + (formFields !== 1 ? 's' : ''), formTrackers > 0 ? formTrackers + ' trackers watching' : 'no trackers'));

    panel.appendChild(grid);
  }

  function summaryCard(label, value, sub) {
    const item = el('div', { className: 'summary-item' });
    item.appendChild(el('div', { className: 'summary-item-label', textContent: label }));
    item.appendChild(el('div', { className: 'summary-item-value', textContent: String(value) }));
    if (sub) item.appendChild(el('div', { className: 'summary-item-sub', textContent: sub }));
    return item;
  }

  function computeBreakdown() {
    const r = reportData;
    const rows = [];
    let pts;

    pts = 0;
    if (r.cookies.thirdParty > 10) pts = 20;
    else if (r.cookies.thirdParty > 3) pts = 10;
    if (r.cookies.longestDays > 365) pts += 5;
    rows.push({ label: 'Cookies', points: pts });

    pts = 0;
    if (r.trackers.total > 10) pts = 25;
    else if (r.trackers.total > 3) pts = 15;
    if (r.trackers.thirdPartyScripts > 15) pts += 10;
    rows.push({ label: 'Trackers', points: pts });

    pts = 0;
    if (r.fingerprinting.techniques >= 3) pts = 25;
    else if (r.fingerprinting.techniques >= 1) pts = 10;
    rows.push({ label: 'Fingerprinting', points: pts });

    pts = 0;
    if (r.pressure.score >= 60) pts = 15;
    else if (r.pressure.score >= 20) pts = 5;
    rows.push({ label: 'Pressure', points: pts });

    pts = 0;
    if (r.tos && r.tos.score >= 60) pts = 10;
    else if (r.tos && r.tos.score >= 30) pts = 5;
    rows.push({ label: 'Terms', points: pts });

    pts = 0;
    if (r.localData.suspicious > 5) pts = 5;
    rows.push({ label: 'Storage', points: pts });

    pts = 0;
    if (r.linkTracking.percentage > 50) pts = 5;
    rows.push({ label: 'Links', points: pts });

    return rows;
  }

  // --- 2. Cookies ---
  function renderCookies() {
    const panel = document.getElementById('panel-cookies');
    panel.innerHTML = '';
    const c = reportData.cookies;
    const raw = reportData.rawCookies || [];

    // Summary cards
    const grid = el('div', { className: 'summary-grid' });
    grid.appendChild(summaryCard('Total Cookies', c.total, ''));
    grid.appendChild(summaryCard('First Party', c.firstParty, 'from this site'));
    grid.appendChild(summaryCard('Third Party', c.thirdParty, 'from outside'));
    grid.appendChild(summaryCard('Longest Expiry', c.longestDays > 0 ? c.longestDays + ' days' : 'Session only', ''));
    panel.appendChild(grid);

    // Filter + actions
    const toolbar = el('div', { className: 'filter-bar' });
    const input = el('input', {
      className: 'filter-input',
      type: 'text',
      placeholder: 'Search cookies by name or domain...',
    });
    input.addEventListener('input', () => {
      cookieFilter = input.value.toLowerCase();
      rebuildCookieTable(panel);
    });
    toolbar.appendChild(input);

    const actions = el('div', { className: 'cookie-actions' });
    const btnThird = el('button', {
      className: 'btn btn-outline-danger',
      textContent: 'Clean Third-Party',
      onClick: () => cleanCookies('thirdParty', actions),
    });
    const btnAll = el('button', {
      className: 'btn btn-danger',
      textContent: 'Clean All',
      onClick: () => cleanCookies('all', actions),
    });
    actions.appendChild(btnThird);
    actions.appendChild(btnAll);
    toolbar.appendChild(actions);
    panel.appendChild(toolbar);

    // Table container
    const tableWrap = el('div', { className: 'data-table-wrap', id: 'cookie-table-wrap' });
    panel.appendChild(tableWrap);

    rebuildCookieTable(panel);
  }

  function rebuildCookieTable(panel) {
    const raw = reportData.rawCookies || [];
    const tableWrap = document.getElementById('cookie-table-wrap');
    if (!tableWrap) return;
    tableWrap.innerHTML = '';

    let filtered = raw;
    if (cookieFilter) {
      filtered = raw.filter(
        (ck) =>
          ck.name.toLowerCase().includes(cookieFilter) ||
          ck.domain.toLowerCase().includes(cookieFilter)
      );
    }

    if (cookieSortCol !== null) {
      filtered = [...filtered].sort((a, b) => {
        let av, bv;
        switch (cookieSortCol) {
          case 'name': av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
          case 'domain': av = a.domain.toLowerCase(); bv = b.domain.toLowerCase(); break;
          case 'expires': av = cookieExpDays(a); bv = cookieExpDays(b); break;
          case 'secure': av = a.secure ? 1 : 0; bv = b.secure ? 1 : 0; break;
          case 'httponly': av = a.httpOnly ? 1 : 0; bv = b.httpOnly ? 1 : 0; break;
          case 'samesite': av = a.sameSite || ''; bv = b.sameSite || ''; break;
          case 'size': av = (a.value || '').length; bv = (b.value || '').length; break;
          default: av = 0; bv = 0;
        }
        if (av < bv) return cookieSortAsc ? -1 : 1;
        if (av > bv) return cookieSortAsc ? 1 : -1;
        return 0;
      });
    }

    if (filtered.length === 0) {
      tableWrap.appendChild(el('div', { className: 'empty-section', textContent: cookieFilter ? 'No cookies match your search.' : 'No cookies found.' }));
      return;
    }

    const table = el('table', { className: 'data-table' });
    const thead = el('thead');
    const headerRow = el('tr');
    const cols = [
      { key: 'name', label: 'Name' },
      { key: 'domain', label: 'Domain' },
      { key: 'expires', label: 'Expires' },
      { key: 'secure', label: 'Secure' },
      { key: 'httponly', label: 'HttpOnly' },
      { key: 'samesite', label: 'SameSite' },
      { key: 'size', label: 'Size' },
    ];
    for (const col of cols) {
      const th = el('th', { textContent: col.label });
      if (cookieSortCol === col.key) {
        th.innerHTML = escHtml(col.label) + ' <span class="sort-arrow">' + (cookieSortAsc ? '\u25B2' : '\u25BC') + '</span>';
      }
      th.addEventListener('click', () => {
        if (cookieSortCol === col.key) cookieSortAsc = !cookieSortAsc;
        else { cookieSortCol = col.key; cookieSortAsc = true; }
        rebuildCookieTable(panel);
      });
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const ck of filtered) {
      const tr = el('tr');
      tr.appendChild(el('td', { className: 'mono', textContent: ck.name }));
      tr.appendChild(el('td', { className: 'mono', textContent: ck.domain }));
      const days = cookieExpDays(ck);
      tr.appendChild(el('td', { textContent: days === -1 ? 'Session' : days + ' days' }));
      tr.appendChild(el('td', { innerHTML: ck.secure ? '<span class="check-yes">Yes</span>' : '<span class="check-no">No</span>' }));
      tr.appendChild(el('td', { innerHTML: ck.httpOnly ? '<span class="check-yes">Yes</span>' : '<span class="check-no">No</span>' }));
      tr.appendChild(el('td', { textContent: ck.sameSite || 'unspecified' }));
      tr.appendChild(el('td', { textContent: (ck.value || '').length + ' B' }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  function cookieExpDays(ck) {
    if (ck.session || !ck.expirationDate) return -1;
    return Math.max(0, Math.round((ck.expirationDate - Date.now() / 1000) / 86400));
  }

  function cleanCookies(mode, actionsEl) {
    chrome.runtime.sendMessage(
      { type: 'cleanCookies', mode: mode, url: reportData.url },
      (response) => {
        let existing = actionsEl.querySelector('.cookie-result');
        if (!existing) {
          existing = el('span', { className: 'cookie-result' });
          actionsEl.appendChild(existing);
        }
        const count = response && response.deleted !== undefined ? response.deleted : 0;
        existing.textContent = count + ' cookie' + (count !== 1 ? 's' : '') + ' deleted';
        // Refresh data after cleaning
        chrome.runtime.sendMessage({ type: 'getFullReport' }, (report) => {
          if (report) {
            reportData = report;
            renderCookies();
          }
        });
      }
    );
  }

  // --- 3. Network ---
  function renderNetwork() {
    const panel = document.getElementById('panel-network');
    panel.innerHTML = '';
    const net = reportData.network;

    if (!net) {
      panel.appendChild(el('div', { className: 'empty-section', textContent: 'No network data available.' }));
      return;
    }

    // Summary cards
    const grid = el('div', { className: 'summary-grid' });
    grid.appendChild(summaryCard('Total Requests', net.totalRequests || 0, ''));
    const domainCount = net.domains ? Object.keys(net.domains).length : 0;
    grid.appendChild(summaryCard('Unique Domains', domainCount, ''));
    const thirdPct = net.totalRequests > 0 ? Math.round(((net.thirdPartyCount || 0) / net.totalRequests) * 100) : 0;
    grid.appendChild(summaryCard('Third Party', thirdPct + '%', (net.thirdPartyCount || 0) + ' requests'));
    const brokerCount = net.brokers ? net.brokers.length : 0;
    grid.appendChild(summaryCard('Data Brokers', brokerCount, brokerCount > 0 ? 'found on this page' : 'none detected'));
    panel.appendChild(grid);

    // Category bar chart
    if (net.categories && Object.keys(net.categories).length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Request Categories' }));
      const chartCard = el('div', { className: 'card' });
      const maxCat = Math.max(...Object.values(net.categories), 1);
      const sortedCats = Object.entries(net.categories).sort((a, b) => b[1] - a[1]);
      for (const [cat, count] of sortedCats) {
        const row = el('div', { className: 'bar-row' });
        const label = el('span', { className: 'bar-label' });
        label.appendChild(el('span', { className: 'cat-tag ' + catClass(cat), textContent: cat }));
        row.appendChild(label);
        const track = el('div', { className: 'bar-track' });
        const bfill = el('div', { className: 'bar-fill' });
        bfill.style.width = Math.max((count / maxCat) * 100, 3) + '%';
        bfill.style.background = catBarColor(cat);
        track.appendChild(bfill);
        row.appendChild(track);
        row.appendChild(el('span', { className: 'bar-value', textContent: count }));
        chartCard.appendChild(row);
      }
      panel.appendChild(chartCard);
    }

    // Domain table
    if (net.domains && Object.keys(net.domains).length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Domains' }));
      const tableWrap = el('div', { className: 'data-table-wrap', id: 'network-table-wrap' });
      panel.appendChild(tableWrap);
      rebuildNetworkTable();
    }

    // Data brokers
    if (net.brokers && net.brokers.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Data Brokers Detected' }));
      const brokersByType = {};
      for (const b of net.brokers) {
        const t = b.type || 'Unknown';
        if (!brokersByType[t]) brokersByType[t] = [];
        brokersByType[t].push(b);
      }
      for (const [type, brokers] of Object.entries(brokersByType)) {
        const group = el('div', { className: 'broker-group' });
        group.appendChild(el('div', { className: 'broker-group-title', textContent: type }));
        for (const b of brokers) {
          const item = el('div', { className: 'broker-item' });
          const info = el('div');
          info.appendChild(el('div', { className: 'broker-name', textContent: escHtml(b.name || b.domain) }));
          if (b.desc) info.appendChild(el('div', { className: 'broker-desc', textContent: b.desc }));
          info.appendChild(el('div', { className: 'mono text-dim mt-8', textContent: b.domain }));
          item.appendChild(info);
          item.appendChild(el('span', { className: 'broker-count', textContent: b.count + ' req' + (b.count !== 1 ? 's' : '') }));
          group.appendChild(item);
        }
        panel.appendChild(group);
      }
    }

    // Redirect chains
    if (net.redirectChains && net.redirectChains.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Redirect Chains' }));
      for (const chain of net.redirectChains) {
        const item = el('div', { className: 'chain-item' });
        item.appendChild(el('div', { className: 'chain-origin', textContent: 'Origin: ' + escHtml(chain.origin) }));
        const path = el('div', { className: 'chain-path' });
        for (let i = 0; i < chain.chain.length; i++) {
          let domainStr;
          try { domainStr = new URL(chain.chain[i]).hostname; } catch { domainStr = chain.chain[i]; }
          if (i > 0) path.appendChild(el('span', { className: 'chain-arrow', textContent: ' \u2192 ' }));
          path.appendChild(el('span', { className: 'chain-domain', textContent: escHtml(domainStr) }));
        }
        item.appendChild(path);
        panel.appendChild(item);
      }
    }
  }

  function rebuildNetworkTable() {
    const net = reportData.network;
    const tableWrap = document.getElementById('network-table-wrap');
    if (!tableWrap || !net || !net.domains) return;
    tableWrap.innerHTML = '';

    let entries = Object.entries(net.domains).map(([domain, info]) => ({ domain, ...info }));

    if (networkSortCol !== null) {
      entries.sort((a, b) => {
        let av, bv;
        switch (networkSortCol) {
          case 'domain': av = a.domain.toLowerCase(); bv = b.domain.toLowerCase(); break;
          case 'category': av = (a.category || '').toLowerCase(); bv = (b.category || '').toLowerCase(); break;
          case 'count': av = a.count || 0; bv = b.count || 0; break;
          case 'thirdparty': av = a.thirdParty ? 1 : 0; bv = b.thirdParty ? 1 : 0; break;
          case 'broker': av = a.brokerName ? 1 : 0; bv = b.brokerName ? 1 : 0; break;
          case 'bytes': av = (a.bytesReceived || 0) + (a.bytesSent || 0); bv = (b.bytesReceived || 0) + (b.bytesSent || 0); break;
          default: av = 0; bv = 0;
        }
        if (av < bv) return networkSortAsc ? -1 : 1;
        if (av > bv) return networkSortAsc ? 1 : -1;
        return 0;
      });
    }

    const table = el('table', { className: 'data-table' });
    const thead = el('thead');
    const headerRow = el('tr');
    const cols = [
      { key: 'domain', label: 'Domain' },
      { key: 'category', label: 'Category' },
      { key: 'count', label: 'Requests' },
      { key: 'thirdparty', label: 'Third Party' },
      { key: 'broker', label: 'Data Broker' },
      { key: 'bytes', label: 'Bytes' },
    ];
    for (const col of cols) {
      const th = el('th', { textContent: col.label });
      if (networkSortCol === col.key) {
        th.innerHTML = escHtml(col.label) + ' <span class="sort-arrow">' + (networkSortAsc ? '\u25B2' : '\u25BC') + '</span>';
      }
      th.addEventListener('click', () => {
        if (networkSortCol === col.key) networkSortAsc = !networkSortAsc;
        else { networkSortCol = col.key; networkSortAsc = true; }
        rebuildNetworkTable();
      });
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = el('tbody');
    for (const d of entries) {
      const tr = el('tr');
      tr.appendChild(el('td', { className: 'mono', textContent: d.domain }));
      const catTd = el('td');
      if (d.category) catTd.appendChild(el('span', { className: 'cat-tag ' + catClass(d.category), textContent: d.category }));
      else catTd.textContent = '-';
      tr.appendChild(catTd);
      tr.appendChild(el('td', { textContent: d.count || 0 }));
      tr.appendChild(el('td', { innerHTML: d.thirdParty ? '<span class="check-no">Yes</span>' : '<span class="text-dim">No</span>' }));
      const brokerTd = el('td');
      if (d.brokerName) {
        brokerTd.appendChild(el('span', { className: 'cat-tag cat-databroker', textContent: escHtml(d.brokerName) }));
      } else {
        brokerTd.textContent = '-';
      }
      tr.appendChild(brokerTd);
      const totalBytes = (d.bytesReceived || 0) + (d.bytesSent || 0);
      tr.appendChild(el('td', { textContent: formatBytes(totalBytes) }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  function catBarColor(cat) {
    const map = {
      advertising: '#e74c3c',
      analytics: '#3498db',
      'data broker': '#9b59b6',
      databroker: '#9b59b6',
      social: '#1abc9c',
      marketing: '#e67e22',
      cdn: '#2ecc71',
      essential: '#8b8fa3',
      fingerprinting: '#e84393',
      'error tracking': '#f1c40f',
      errortracking: '#f1c40f',
    };
    return map[(cat || '').toLowerCase().replace(/[\s-]+/g, '')] || '#6b6f83';
  }

  // --- 4. Trackers ---
  function renderTrackers() {
    const panel = document.getElementById('panel-trackers');
    panel.innerHTML = '';
    const t = reportData.trackers;

    if (t.total === 0 && t.thirdPartyScripts === 0) {
      panel.appendChild(el('div', { className: 'empty-section', textContent: 'No hidden trackers or third-party scripts found on this page.' }));
      return;
    }

    // Companies by purpose
    if (t.companies && t.companies.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Tracking Companies' }));
      const byPurpose = {};
      for (const c of t.companies) {
        const p = c.purpose || 'Other';
        if (!byPurpose[p]) byPurpose[p] = [];
        byPurpose[p].push(c);
      }
      const purposeOrder = ['Advertising', 'Analytics', 'Data broker', 'Marketing', 'Error tracking', 'Social', 'Other'];
      for (const purpose of purposeOrder) {
        if (!byPurpose[purpose]) continue;
        const group = el('div', { className: 'purpose-group' });
        const title = el('div', { className: 'purpose-group-title' });
        title.appendChild(el('span', { className: 'cat-tag ' + catClass(purpose), textContent: purpose }));
        title.appendChild(el('span', { className: 'text-dim', textContent: byPurpose[purpose].length + ' compan' + (byPurpose[purpose].length !== 1 ? 'ies' : 'y') }));
        group.appendChild(title);

        for (const company of byPurpose[purpose]) {
          const card = el('div', { className: 'company-card' });
          card.appendChild(el('span', { className: 'company-card-name', textContent: escHtml(company.name) }));
          if (company.count) card.appendChild(el('span', { className: 'company-card-count', textContent: company.count + ' element' + (company.count !== 1 ? 's' : '') }));
          group.appendChild(card);
        }
        panel.appendChild(group);
        delete byPurpose[purpose];
      }
      // Remaining purposes
      for (const [purpose, companies] of Object.entries(byPurpose)) {
        const group = el('div', { className: 'purpose-group' });
        const title = el('div', { className: 'purpose-group-title' });
        title.appendChild(el('span', { className: 'cat-tag cat-unknown', textContent: purpose }));
        title.appendChild(el('span', { className: 'text-dim', textContent: companies.length + ' compan' + (companies.length !== 1 ? 'ies' : 'y') }));
        group.appendChild(title);
        for (const company of companies) {
          const card = el('div', { className: 'company-card' });
          card.appendChild(el('span', { className: 'company-card-name', textContent: escHtml(company.name) }));
          if (company.count) card.appendChild(el('span', { className: 'company-card-count', textContent: company.count + ' element' + (company.count !== 1 ? 's' : '') }));
          group.appendChild(card);
        }
        panel.appendChild(group);
      }
    }

    // 3P scripts
    if (t.thirdPartyScripts > 0 && t.scriptCompanies && t.scriptCompanies.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Third-Party Scripts (' + t.thirdPartyScripts + ')' }));
      const card = el('div', { className: 'card' });
      for (const sc of t.scriptCompanies) {
        const row = el('div', { className: 'company-card' });
        row.appendChild(el('span', { className: 'company-card-name', textContent: escHtml(sc.name) }));
        if (sc.count) row.appendChild(el('span', { className: 'company-card-count', textContent: sc.count + ' script' + (sc.count !== 1 ? 's' : '') }));
        card.appendChild(row);
      }
      panel.appendChild(card);
    }
  }

  // --- 5. Terms ---
  function renderTerms() {
    const panel = document.getElementById('panel-terms');
    panel.innerHTML = '';
    const tos = reportData.tos;

    if (!tos) {
      panel.appendChild(el('div', { className: 'empty-section', textContent: 'No terms data available.' }));
      return;
    }

    if (tos.loading) {
      panel.innerHTML = '<div class="tos-loading-msg"><span class="spinner"></span>Looking for their privacy policy and terms...</div>';
      return;
    }

    if (tos.found === false) {
      panel.innerHTML = '<div class="tos-not-found">Couldn\'t find a terms or privacy policy page for this site. Look for a link at the bottom of their homepage.</div>';
      return;
    }

    // Score
    const rc = riskColor(tos.score);
    const scoreRow = el('div', { className: 'tos-score-display' });
    scoreRow.appendChild(el('div', { className: 'tos-score-number color-' + rc, textContent: tos.score }));
    const label = el('div');
    label.appendChild(el('div', { className: 'tos-score-label', textContent: 'Terms toxicity score (0 = fair, 100 = hostile)' }));
    scoreRow.appendChild(label);
    panel.appendChild(scoreRow);

    // Flagged clauses
    if (tos.flagged && tos.flagged.length > 0) {
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
    } else {
      panel.appendChild(el('div', { className: 'empty-section', textContent: 'Terms look reasonable. No concerning clauses flagged.' }));
    }
  }

  // --- 6. Data (Storage + Links) ---
  function renderData() {
    const panel = document.getElementById('panel-data');
    panel.innerHTML = '';
    const ld = reportData.localData;
    const lt = reportData.linkTracking;

    // Storage section
    panel.appendChild(el('div', { className: 'section-heading', textContent: 'Local Storage' }));

    if (ld.suspicious > 0 && ld.byCategory && Object.keys(ld.byCategory).length > 0) {
      const catOrder = ['Cross-site tracking', 'Advertising', 'Fingerprinting', 'PII exposure', 'PII', 'Tracking'];
      const rendered = new Set();

      for (const cat of catOrder) {
        const keys = ld.byCategory[cat];
        if (!keys || keys.length === 0) continue;
        rendered.add(cat);
        panel.appendChild(buildDataCategory(cat, keys));
      }
      // Remaining categories
      for (const [cat, keys] of Object.entries(ld.byCategory)) {
        if (rendered.has(cat) || !keys || keys.length === 0) continue;
        panel.appendChild(buildDataCategory(cat, keys));
      }
    } else if (ld.totalKeys > 0) {
      panel.appendChild(el('div', { className: 'card', innerHTML: '<div class="text-dim">' + ld.totalKeys + ' items stored, nothing suspicious.</div>' }));
    } else {
      panel.appendChild(el('div', { className: 'card', innerHTML: '<div class="text-dim">No local storage data found.</div>' }));
    }

    // Links section
    panel.appendChild(el('div', { className: 'section-heading mt-16', textContent: 'Link Tracking' }));
    const linkGrid = el('div', { className: 'summary-grid' });
    linkGrid.appendChild(summaryCard('Links Tracked', lt.tracked + ' of ' + lt.total, lt.percentage + '% have tracking params'));
    linkGrid.appendChild(summaryCard('Redirect Wrappers', lt.redirectWrappers, 'links routed through trackers'));
    panel.appendChild(linkGrid);

    if (lt.details && lt.details.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Tracked Links' }));
      const maxLinks = 30;
      const shown = lt.details.slice(0, maxLinks);
      for (const link of shown) {
        const href = link.href || link.url || String(link);
        const item = el('div', { className: 'link-item' });
        item.innerHTML = highlightTrackingParams(escHtml(truncateStr(href, 200)));
        panel.appendChild(item);
      }
      if (lt.details.length > maxLinks) {
        panel.appendChild(el('div', { className: 'text-dim mt-8', textContent: '+ ' + (lt.details.length - maxLinks) + ' more tracked links' }));
      }
    }
  }

  function buildDataCategory(cat, keys) {
    const div = el('div', { className: 'data-category' });
    const header = el('div', { className: 'data-category-header' });
    header.appendChild(el('span', { className: 'data-category-name', textContent: cat }));
    header.appendChild(el('span', { className: 'data-category-count', textContent: keys.length }));
    div.appendChild(header);
    const list = el('div', { className: 'data-key-list' });
    for (const key of keys) {
      list.appendChild(el('span', { className: 'data-key', textContent: escHtml(typeof key === 'string' ? key : key.key || String(key)) }));
    }
    div.appendChild(list);
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

  // --- 7. Fingerprinting ---
  function renderFingerprinting() {
    const panel = document.getElementById('panel-fingerprinting');
    panel.innerHTML = '';
    const fp = reportData.fingerprinting;

    // Status
    if (fp.techniques > 0) {
      panel.appendChild(el('div', { className: 'fp-status fp-status-active', textContent: 'Fingerprinting Active' }));
      panel.appendChild(el('div', { className: 'fp-status-explain', textContent: 'This site is reading your device properties to build a unique ID that persists even if you clear cookies.' }));
    } else {
      panel.appendChild(el('div', { className: 'fp-status fp-status-none', textContent: 'No Fingerprinting Detected' }));
      panel.appendChild(el('div', { className: 'fp-status-explain', textContent: 'This site is not using known fingerprinting techniques to identify your device.' }));
      return;
    }

    // Technique cards
    const explanations = {
      Navigator: 'Reads your browser type, language, CPU cores, and RAM to profile your device.',
      Screen: 'Reads your display resolution and color depth to narrow down your device.',
      WebGL: 'Reads your graphics card model via GPU rendering to identify your hardware.',
      Canvas: 'Draws invisible images and reads pixel data for GPU fingerprinting.',
      AudioContext: 'Creates silent audio and reads processing patterns unique to your hardware.',
      Font: 'Probes for installed fonts to narrow down your operating system and software.',
      Battery: 'Reads battery level and charging state as a tracking signal.',
      Connection: 'Reads your network connection type and speed.',
    };

    for (const m of fp.methods) {
      const card = el('div', { className: 'fp-card' });
      const header = el('div', { className: 'fp-card-header' });
      header.appendChild(el('span', { className: 'fp-card-technique', textContent: escHtml(m.technique) }));
      header.appendChild(el('span', { className: 'fp-card-calls', textContent: m.calls + ' API call' + (m.calls !== 1 ? 's' : '') }));
      card.appendChild(header);

      const explain = explanations[m.technique] || 'Reads device properties for identification purposes.';
      card.appendChild(el('div', { className: 'fp-card-explain', textContent: explain }));

      if (m.apis && m.apis.length > 0) {
        const apisDiv = el('div', { className: 'fp-card-apis' });
        apisDiv.appendChild(document.createTextNode('APIs: '));
        for (let i = 0; i < m.apis.length; i++) {
          if (i > 0) apisDiv.appendChild(document.createTextNode(' '));
          apisDiv.appendChild(el('code', { textContent: m.apis[i] }));
        }
        card.appendChild(apisDiv);
      }

      panel.appendChild(card);
    }
  }

  // --- 8. Forms ---
  function renderForms() {
    const panel = document.getElementById('panel-forms');
    panel.innerHTML = '';
    const f = reportData.forms;

    if (!f) {
      panel.appendChild(el('div', { className: 'empty-section', textContent: 'No form data available.' }));
      return;
    }

    // Fields
    if (f.fields && f.fields.length > 0) {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Form Fields Found' }));
      const list = el('div', { className: 'form-field-list' });
      for (const field of f.fields) {
        list.appendChild(el('span', { className: 'form-field-tag', textContent: escHtml(field) }));
      }
      panel.appendChild(list);
    } else {
      panel.appendChild(el('div', { className: 'section-heading', textContent: 'Form Fields' }));
      panel.appendChild(el('div', { className: 'card', innerHTML: '<div class="text-dim">No form fields detected on this page.</div>' }));
    }

    // Trackers while typing
    panel.appendChild(el('div', { className: 'section-heading', textContent: 'Trackers While Typing' }));

    if (f.trackersWhileTyping > 0) {
      const status = el('div', { className: 'form-status form-status-warn' });
      status.textContent = f.trackersWhileTyping + ' tracker' + (f.trackersWhileTyping !== 1 ? 's' : '') + ' watching while you type';
      panel.appendChild(status);

      if (f.trackerNames && f.trackerNames.length > 0) {
        const names = el('div', { className: 'form-tracker-names' });
        names.textContent = 'Companies: ' + f.trackerNames.map((n) => escHtml(n)).join(', ');
        panel.appendChild(names);
      }
    } else {
      const status = el('div', { className: 'form-status form-status-ok' });
      status.textContent = 'No trackers present while forms are on this page.';
      panel.appendChild(status);
    }
  }
})();
