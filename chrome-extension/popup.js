/**
 * popup.js — Renders the unified privacy scan popup.
 * Queries background.js for the current tab's report and renders casual-language results.
 */

chrome.runtime.sendMessage({ type: 'getReport' }, render);

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

  // Sections
  const sections = document.getElementById('sections');
  sections.innerHTML = '';

  sections.appendChild(cookiesSection(report.cookies));
  sections.appendChild(trackersSection(report.trackers));
  sections.appendChild(fingerprintingSection(report.fingerprinting));
  sections.appendChild(pressureSection(report.pressure));
  sections.appendChild(tosSection(report.tos));
  sections.appendChild(localDataSection(report.localData));
  sections.appendChild(linkTrackingSection(report.linkTracking));
}

// --- Section builders ---

function makeSection(icon, label, value, valueClass, detailHTML) {
  const div = document.createElement('div');
  div.className = 'section';
  div.innerHTML = `
    <div class="section-header">
      <span class="section-icon">${icon}</span>
      <span class="section-label">${label}</span>
      <span class="section-value ${valueClass}">${value}</span>
    </div>
    <div class="section-detail">${detailHTML}</div>
  `;
  return div;
}

function cookiesSection(c) {
  const val = c.thirdParty > 5 ? `${c.total} on you` : c.total > 0 ? `${c.total}` : '0';
  const cls = c.thirdParty > 5 ? 'val-bad' : c.thirdParty > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (c.thirdParty > 0) {
    detail = `${c.firstParty} from this site · ${c.thirdParty} from outside`;
    if (c.thirdPartyDomains.length) {
      detail += '<br>' + c.thirdPartyDomains.slice(0, 5).map(d => `<span class="domain-tag">${d}</span>`).join(' ');
    }
  } else {
    detail = `All ${c.firstParty} from this site only`;
  }
  if (c.longestDays > 0) {
    detail += ` · longest lasts ${c.longestDays > 365 ? Math.round(c.longestDays / 365) + ' year(s)' : c.longestDays + ' days'}`;
  }
  return makeSection('🍪', 'Cookies', val, cls, detail);
}

function trackersSection(t) {
  const total = t.total;
  const val = total > 0 ? `${total} hidden` : 'None';
  const cls = total > 10 ? 'val-bad' : total > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (total > 0) {
    const parts = [];
    if (t.beacons) parts.push(`${t.beacons} silent ping${t.beacons > 1 ? 's' : ''}`);
    if (t.pixels) parts.push(`${t.pixels} tracking pixel${t.pixels > 1 ? 's' : ''}`);
    if (t.hiddenIframes) parts.push(`${t.hiddenIframes} invisible frame${t.hiddenIframes > 1 ? 's' : ''}`);
    detail = parts.join(' · ');
    if (t.domains.length) {
      detail += '<br>Sending to: ' + t.domains.slice(0, 4).map(d => `<span class="domain-tag">${d}</span>`).join(' ');
    }
  } else {
    detail = 'No hidden trackers found';
  }
  if (t.thirdPartyScripts > 0) {
    detail += `<br><span class="highlight">${t.thirdPartyScripts} outside script${t.thirdPartyScripts > 1 ? 's' : ''} loaded</span>`;
  }

  return makeSection('👁', 'Trackers', val, cls, detail);
}

function fingerprintingSection(fp) {
  const val = fp.techniques > 0 ? `${fp.techniques} method${fp.techniques > 1 ? 's' : ''}` : 'None';
  const cls = fp.techniques >= 3 ? 'val-bad' : fp.techniques > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (fp.techniques > 0) {
    detail = 'Reading your device specs to ID you';
    const maxCalls = Math.max(...fp.methods.map(m => m.calls), 1);
    detail += '<div style="margin-top:4px">';
    for (const m of fp.methods) {
      const pct = Math.max(Math.round((m.calls / maxCalls) * 100), 8);
      detail += `<div class="fp-row">
        <span class="fp-name">${m.technique}</span>
        <div class="fp-bar"><div class="fp-bar-fill" style="width:${pct}%"></div></div>
        <span class="fp-count">${m.calls} call${m.calls > 1 ? 's' : ''}</span>
      </div>`;
    }
    detail += '</div>';
  } else {
    detail = 'Not fingerprinting your device ✓';
  }

  return makeSection('🖐', 'Fingerprinting', val, cls, detail);
}

function pressureSection(p) {
  const val = p.score > 0 ? `${p.score}/100` : 'None';
  const cls = p.score >= 60 ? 'val-bad' : p.score > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (p.tactics.length > 0) {
    detail = p.tactics.map(t => {
      let html = t.tactic;
      if (t.evidence.length) {
        html += `<span class="evidence">"${escHtml(t.evidence[0])}"</span>`;
      }
      return html;
    }).join('<br>');
  } else {
    detail = 'No tricks to rush or guilt you ✓';
  }

  return makeSection('⚡', 'Pressure', val, cls, detail);
}

function tosSection(tos) {
  if (!tos || tos.loading) {
    return makeSection('📋', 'Terms', '...', 'val-neutral', '<span class="tos-loading">Looking for their privacy policy...</span>');
  }

  if (!tos.found) {
    return makeSection('📋', 'Terms', '???', 'val-neutral', "Couldn't find their terms page. Look for a link at the bottom.");
  }

  const val = `${tos.score}/100`;
  const cls = tos.score >= 60 ? 'val-bad' : tos.score >= 30 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (tos.flagged.length > 0) {
    detail = tos.flagged.map(f => f.label).join(' · ');
  } else {
    detail = 'Terms look reasonable ✓';
  }

  return makeSection('📋', 'Terms', val, cls, detail);
}

function localDataSection(ld) {
  const val = ld.suspicious > 0 ? `${ld.suspicious} suspicious` : ld.totalKeys > 0 ? `${ld.totalKeys} items` : 'None';
  const cls = ld.suspicious > 5 ? 'val-bad' : ld.suspicious > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (ld.suspicious > 0) {
    detail = `${ld.totalKeys} items stored, ${ld.suspicious} look like tracking IDs`;
    if (ld.flagged.length) {
      detail += '<br>' + ld.flagged.slice(0, 3).map(f => `<span class="domain-tag">${f.key}</span>`).join(' ');
    }
  } else if (ld.totalKeys > 0) {
    detail = `${ld.totalKeys} items stored, nothing suspicious ✓`;
  } else {
    detail = 'Nothing stored on your device ✓';
  }

  return makeSection('💾', 'Stored on you', val, cls, detail);
}

function linkTrackingSection(lt) {
  const pct = lt.percentage;
  const val = pct > 0 ? `${pct}%` : 'None';
  const cls = pct > 50 ? 'val-bad' : pct > 0 ? 'val-warn' : 'val-clean';

  let detail = '';
  if (lt.tracked > 0) {
    detail = `${lt.tracked} of ${lt.total} links have tags so they know what you click`;
    if (lt.redirectWrappers > 0) {
      detail += ` · ${lt.redirectWrappers} redirect wrapper${lt.redirectWrappers > 1 ? 's' : ''}`;
    }
  } else {
    detail = lt.total > 0 ? 'Links are clean — no tracking tags ✓' : 'No links found on page';
  }

  return makeSection('🔗', 'Links', val, cls, detail);
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
