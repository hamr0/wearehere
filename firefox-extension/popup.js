/**
 * popup.js — Simplified privacy scan popup with 8 sections (Firefox).
 * Queries background.js for the current tab's report and renders casual-language results.
 */

browser.runtime.sendMessage({ type: 'getReport' }).then(render);

function render(report) {
  document.getElementById('loading').style.display = 'none';

  if (!report) {
    document.getElementById('empty').style.display = 'flex';
    return;
  }

  document.getElementById('report').style.display = 'block';

  // Header
  document.getElementById('site-name').textContent = report.site;
  const badge = document.getElementById('score-badge');
  const v = report.verdict;
  badge.textContent = `${v.score}/100 ${v.risk.toUpperCase()}`;
  badge.className = `risk-${v.risk}`;

  // Risk bar
  const fill = document.getElementById('risk-fill');
  fill.style.width = v.score + '%';
  if (v.score <= 15) fill.style.background = '#2ecc71';
  else if (v.score <= 40) fill.style.background = '#e67e22';
  else fill.style.background = '#e74c3c';

  // Summary
  document.getElementById('summary').textContent = v.recommendation;

  // 8 Sections
  const sections = document.getElementById('sections');
  sections.innerHTML = '';

  sections.appendChild(cookiesSection(report.cookies));
  sections.appendChild(networkSection(report.network));
  sections.appendChild(trackersSection(report.trackers));
  sections.appendChild(pressureSection(report.pressure));
  sections.appendChild(sellingDataSection(report.network));
  sections.appendChild(profilingSection(report.fingerprinting));
  sections.appendChild(localDataSection(report.localData));
  sections.appendChild(formsSection(report.forms));
  sections.appendChild(linkTrackingSection(report.linkTracking));
  sections.appendChild(tosSection(report.tos));

  // Full Report button
  const btn = document.createElement('button');
  btn.id = 'full-report-btn';
  btn.textContent = 'Full Report';
  sections.after(btn);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.query({ active: true, currentWindow: true }).then((activeTabs) => {
      const tabId = activeTabs[0] ? activeTabs[0].id : '';
      const reportUrl = browser.runtime.getURL('report.html') + '#' + tabId;

      // Ask background for existing dashboard tab ID
      browser.runtime.sendMessage({ type: 'openDashboard', url: reportUrl }).then((res) => {
        if (res && res.existingTabId) {
          browser.tabs.update(res.existingTabId, { url: reportUrl, active: true });
        } else {
          browser.tabs.create({ url: reportUrl });
        }
      });
    });
  });
}

// --- Section builders ---

function makeSection(iconSrc, label, value, valueClass, detailHTML) {
  const div = document.createElement('div');
  div.className = 'section';
  div.innerHTML = `
    <div class="section-header">
      <img class="section-icon" src="${iconSrc}" alt="">
      <span class="section-label">${label}</span>
      <span class="section-value ${valueClass}">${value}</span>
    </div>
    <div class="section-detail">${detailHTML}</div>
  `;
  return div;
}

function cookiesSection(c) {
  const val = c.thirdParty > 5 ? `${c.total}` : c.total > 0 ? `${c.total}` : '0';
  const cls = c.thirdParty > 5 ? 'val-bad' : c.thirdParty > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (c.thirdParty > 0) {
    detail = `${c.firstParty} from this site · ${c.thirdParty} from outside`;
  } else {
    detail = `All from this site`;
  }
  if (c.longestDays > 0) {
    detail += ` · last ${c.longestDays > 365 ? Math.round(c.longestDays / 365) + ' year(s)' : c.longestDays + ' days'}`;
  }
  return makeSection('icons/cooked.png', 'Cookies', val, cls, detail);
}

function networkSection(n) {
  if (!n) return makeSection('icons/baked.png', 'Network', '0', 'val-clean', 'No network data yet');
  const val = n.trackerDomains > 0 ? `${n.trackerDomains}` : '0';
  const cls = n.trackerDomains > 10 ? 'val-bad' : n.trackerDomains > 0 ? 'val-warn' : 'val-clean';
  let detail = `${n.totalRequests} requests · ${n.thirdPartyDomains} third-party domain${n.thirdPartyDomains !== 1 ? 's' : ''}`;
  return makeSection('icons/baked.png', 'Network', val + ' trackers', cls, detail);
}

function trackersSection(t) {
  const companies = t.companies || [];
  const names = [...new Set(companies.map(c => c.name))];
  const val = names.length > 0 ? `${names.length}` : 'None';
  const cls = t.total > 10 ? 'val-bad' : t.total > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (names.length > 0) {
    detail = names.slice(0, 4).map(n => escHtml(n)).join(' · ');
    if (names.length > 4) detail += ` +${names.length - 4} more`;
  } else {
    detail = 'No hidden trackers found';
  }
  if (t.thirdPartyScripts > 0) {
    detail += `<br><span class="highlight">${t.thirdPartyScripts} outside scripts loaded</span>`;
  }

  return makeSection('icons/cooked.png', 'Trackers', val, cls, detail);
}

function profilingSection(fp) {
  const val = fp.techniques > 0 ? 'Active' : 'None';
  const cls = fp.techniques >= 3 ? 'val-bad' : fp.techniques > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (fp.techniques > 0) {
    const names = fp.methods.map(m => m.technique);
    detail = `Reading your ${names.join(', ')} to build a device ID`;
  } else {
    detail = 'Not fingerprinting your device ✓';
  }

  return makeSection('icons/watched.png', 'Profiling', val, cls, detail);
}

function pressureSection(p) {
  const val = p.score > 0 ? `${p.score}/100` : 'None';
  const cls = p.score >= 60 ? 'val-bad' : p.score > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (p.tactics.length > 0) {
    detail = p.tactics.map(t => {
      let html = escHtml(t.tactic);
      if (t.evidence.length) {
        html += `<span class="evidence">"${escHtml(t.evidence[0])}"</span>`;
      }
      return html;
    }).join('<br>');
  } else {
    detail = 'No tricks to rush or guilt you ✓';
  }

  return makeSection('icons/played.png', 'Pressure', val, cls, detail);
}

function sellingDataSection(n) {
  if (!n) return makeSection('icons/baked.png', 'Selling data', 'None', 'val-clean', 'No data brokers detected');
  const val = n.brokerCount > 0 ? `${n.brokerCount}` : 'None';
  const cls = n.brokerCount > 5 ? 'val-bad' : n.brokerCount > 0 ? 'val-warn' : 'val-clean';
  const detail = n.brokerCount > 0 ? `${n.brokerCount} data broker${n.brokerCount !== 1 ? 's' : ''} found in network traffic` : 'No data brokers detected';
  return makeSection('icons/baked.png', 'Selling data', val, cls, detail);
}

function tosSection(tos) {
  if (!tos || tos.loading) {
    return makeSection('icons/tosed.png', 'Terms', '...', 'val-neutral', "Couldn't analyze — try visiting their privacy policy page directly, then come back here.");
  }
  if (!tos.found) {
    return makeSection('icons/tosed.png', 'Terms', '???', 'val-neutral', "Couldn't find their terms page");
  }

  const val = `${tos.score}/100`;
  const cls = tos.score >= 60 ? 'val-bad' : tos.score >= 30 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (tos.flagged.length > 0) {
    detail = tos.flagged.map(f => escHtml(f.label)).join(' · ');
  } else {
    detail = 'Terms look reasonable ✓';
  }

  return makeSection('icons/tosed.png', 'Terms', val, cls, detail);
}

function localDataSection(ld) {
  const val = ld.suspicious > 0 ? `${ld.suspicious}` : ld.totalKeys > 0 ? `${ld.totalKeys}` : 'None';
  const cls = ld.suspicious > 5 ? 'val-bad' : ld.suspicious > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (ld.suspicious > 0) {
    const cats = ld.byCategory || {};
    const catNames = Object.keys(cats).filter(c => cats[c]?.length > 0);
    if (catNames.length) {
      detail = catNames.map(c => escHtml(c)).join(' · ');
    } else {
      detail = `${ld.suspicious} tracking IDs found`;
    }
  } else if (ld.totalKeys > 0) {
    detail = `${ld.totalKeys} items, nothing suspicious ✓`;
  } else {
    detail = 'Nothing stored ✓';
  }

  return makeSection('icons/leaking.png', 'Stored data', val, cls, detail);
}

function linkTrackingSection(lt) {
  const val = lt.percentage > 0 ? `${lt.percentage}%` : 'None';
  const cls = lt.percentage > 50 ? 'val-bad' : lt.percentage > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (lt.tracked > 0) {
    detail = `${lt.tracked} of ${lt.total} links tag your clicks`;
    if (lt.redirectWrappers > 0) detail += ` · ${lt.redirectWrappers} redirect wrapper${lt.redirectWrappers > 1 ? 's' : ''}`;
  } else {
    detail = lt.total > 0 ? 'Links are clean ✓' : 'No links found';
  }

  return makeSection('icons/linked.png', 'Clicks', val, cls, detail);
}

function formsSection(f) {
  if (!f || f.fieldCount === 0) {
    return makeSection('icons/silent.png', 'Watching', 'None', 'val-clean', 'No form fields on this page');
  }

  const watching = f.trackersWhileTyping || 0;
  const val = watching > 0 ? `${watching}` : 'Clean';
  const cls = watching > 3 ? 'val-bad' : watching > 0 ? 'val-warn' : 'val-clean';

  let detail = `${f.fieldCount} field${f.fieldCount > 1 ? 's' : ''} on this page`;
  if (watching > 0 && f.trackerNames.length > 0) {
    detail += `. ${f.trackerNames.map(n => escHtml(n)).join(', ')} active while you type`;
  } else if (watching === 0) {
    detail += ' · not being watched ✓';
  }

  return makeSection('icons/silent.png', 'Watching', val, cls, detail);
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
