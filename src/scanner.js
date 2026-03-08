/**
 * scanner.js — Orchestrates a full privacy scan of a website.
 *
 * Flow:
 *   1. connect() to browser via barebrowse
 *   2. Inject init scripts (fingerprinting/beacon wrappers) BEFORE navigation
 *   3. Navigate to URL
 *   4. Wait for network to settle (let trackers load)
 *   5. Run page scripts (cookies, trackers, pressure tactics, storage, links)
 *   6. Collect init script results (fingerprinting calls, beacon interceptions)
 *   7. Build structured report with plain-language summary
 *   8. Close browser
 */

import { connect } from 'barebrowse';
import { getInitScript } from './init-scripts.js';
import { getPageScript } from './page-scripts.js';

/**
 * Scan a website and return a full privacy audit.
 *
 * @param {string} url - URL to scan
 * @param {object} [opts]
 * @param {string[]} [opts.categories] - Optional filter: ['cookies','trackers','fingerprinting','pressure','storage','links']
 * @param {number} [opts.timeout] - Navigation timeout in ms (default: 30000)
 * @param {number} [opts.settle] - Time to wait for trackers to load after page load, in ms (default: 3000)
 * @returns {Promise<object>} Full scan report
 */
export async function scanSite(url, opts = {}) {
  const timeout = opts.timeout || 30000;
  const settle = opts.settle || 3000;
  const categories = opts.categories || null; // null = all

  let page;
  try {
    page = await connect({ mode: 'headless' });
    const session = page.cdp;

    // Inject init scripts BEFORE navigation (fingerprinting + beacon wrappers)
    if (!categories || categories.includes('fingerprinting') || categories.includes('trackers')) {
      await session.send('Page.addScriptToEvaluateOnNewDocument', {
        source: getInitScript(),
      });
    }

    await page.goto(url, timeout);

    // Wait for network to settle — let tracking pixels, beacons, and 3P scripts load
    try {
      await page.waitForNetworkIdle({ timeout: settle, idle: 1000 });
    } catch {
      // Timeout is fine — some sites never stop making requests
    }

    // Run page-level detection scripts
    const { result: pageResult } = await session.send('Runtime.evaluate', {
      expression: getPageScript(),
      returnByValue: true,
    });

    let pageData = {};
    try {
      pageData = JSON.parse(pageResult.value || '{}');
    } catch {
      pageData = { error: 'Failed to parse page scan results' };
    }

    // Collect init script results (fingerprinting, beacons)
    let initData = { fingerprinting: [], beacons: [] };
    if (!categories || categories.includes('fingerprinting') || categories.includes('trackers')) {
      const { result: initResult } = await session.send('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__wearehere || {})',
        returnByValue: true,
      });
      try {
        initData = JSON.parse(initResult.value || '{}');
      } catch {}
    }

    // Get cookies via CDP (more complete than document.cookie)
    let cdpCookies = [];
    try {
      const { cookies } = await session.send('Network.getCookies', { urls: [url] });
      cdpCookies = cookies || [];
    } catch {}

    return buildReport(url, pageData, initData, cdpCookies, categories);
  } finally {
    if (page) {
      try { await page.close(); } catch {}
    }
  }
}

// --- Report builder ---

function buildReport(url, pageData, initData, cdpCookies, categories) {
  const host = new URL(url).hostname;
  const include = (cat) => !categories || categories.includes(cat);

  const report = {
    site: host,
    url,
    scanned_at: new Date().toISOString(),
  };

  // --- COOKIES ---
  if (include('cookies')) {
    const firstParty = cdpCookies.filter(c =>
      c.domain.includes(host) || host.includes(c.domain.replace(/^\./, ''))
    );
    const thirdParty = cdpCookies.filter(c =>
      !c.domain.includes(host) && !host.includes(c.domain.replace(/^\./, ''))
    );
    const tpDomains = [...new Set(thirdParty.map(c => c.domain.replace(/^\./, '')))];
    const persistent = cdpCookies.filter(c => !c.session);
    // Find longest-living cookie
    let longestDays = 0;
    for (const c of persistent) {
      if (c.expires) {
        const days = Math.round((c.expires * 1000 - Date.now()) / 86400000);
        if (days > longestDays) longestDays = days;
      }
    }

    report.cookies = {
      finding: thirdParty.length > 5
        ? `${thirdParty.length} third-party cookies from ${tpDomains.length} external domains are tracking you across sites`
        : thirdParty.length > 0
          ? `${thirdParty.length} third-party cookies detected`
          : `No third-party cookies — only ${firstParty.length} first-party cookies`,
      total: cdpCookies.length,
      first_party: firstParty.length,
      third_party: {
        count: thirdParty.length,
        domains: tpDomains.slice(0, 20),
      },
      persistence: {
        session: cdpCookies.filter(c => c.session).length,
        persistent: persistent.length,
        longest_expiry_days: longestDays || null,
      },
    };
  }

  // --- TRACKERS (pixels, beacons, hidden iframes, 3P scripts) ---
  if (include('trackers')) {
    const beacons = initData.beacons || [];
    const beaconDomains = [];
    for (const b of beacons) {
      try { beaconDomains.push(new URL(b.url).hostname); } catch {}
    }

    const pixelCount = pageData.trackers?.pixels || 0;
    const iframeCount = pageData.trackers?.hidden_iframes || 0;
    const scriptCount = pageData.third_party_scripts?.total || 0;
    const allDomains = [
      ...(pageData.trackers?.pixel_domains || []),
      ...(pageData.trackers?.iframe_domains || []),
      ...beaconDomains,
      ...(pageData.third_party_scripts?.domains || []),
    ];
    const uniqueDomains = [...new Set(allDomains)].slice(0, 30);
    const total = pixelCount + beacons.length + iframeCount;

    report.trackers = {
      finding: total > 10
        ? `Heavy surveillance: ${total} hidden tracking elements and ${scriptCount} third-party scripts sending data to ${uniqueDomains.length} external domains`
        : total > 0
          ? `${total} hidden tracking elements detected (${pixelCount} pixels, ${beacons.length} beacons, ${iframeCount} hidden iframes) plus ${scriptCount} third-party scripts`
          : scriptCount > 0
            ? `No hidden trackers but ${scriptCount} third-party scripts loaded from ${uniqueDomains.length} domains`
            : 'No tracking infrastructure detected',
      hidden_pixels: pixelCount,
      beacons: beacons.length,
      hidden_iframes: iframeCount,
      third_party_scripts: scriptCount,
      domains: uniqueDomains,
    };
  }

  // --- FINGERPRINTING ---
  if (include('fingerprinting')) {
    const calls = initData.fingerprinting || [];
    const byCat = {};
    for (const call of calls) {
      const cat = call.category || 'Unknown';
      if (!byCat[cat]) byCat[cat] = { count: 0, apis: new Set() };
      byCat[cat].count++;
      byCat[cat].apis.add(call.api);
    }

    const methods = Object.entries(byCat).map(([category, data]) => ({
      technique: category,
      apis_used: [...data.apis],
      times_called: data.count,
    }));

    const techniqueNames = methods.map(m => m.technique);

    report.fingerprinting = {
      finding: methods.length >= 3
        ? `Aggressive device fingerprinting: ${methods.length} techniques used (${techniqueNames.join(', ')}) with ${calls.length} total API calls to uniquely identify your browser`
        : methods.length > 0
          ? `${methods.length} fingerprinting technique${methods.length > 1 ? 's' : ''} detected: ${techniqueNames.join(', ')}`
          : 'No fingerprinting detected',
      techniques_used: methods.length,
      total_api_calls: calls.length,
      breakdown: methods,
    };
  }

  // --- PRESSURE TACTICS (dark patterns) ---
  if (include('pressure')) {
    const dp = pageData.dark_patterns || { score: 0, detected: [] };
    const detected = dp.detected || [];
    const tactics = detected.map(d => {
      const labels = {
        confirm_shaming: 'Guilt-tripping language on decline buttons',
        fake_urgency: 'Fake urgency or scarcity claims',
        countdown_timer: 'Countdown timer creating artificial time pressure',
        pre_checked_boxes: 'Pre-checked consent boxes opting you into things',
        hidden_unsubscribe: 'Opt-out/unsubscribe text made intentionally hard to find',
      };
      return {
        tactic: labels[d.type] || d.type,
        type: d.type,
        evidence: d.matches?.slice(0, 3) || [],
      };
    });

    report.pressure = {
      finding: dp.score >= 60
        ? `High manipulation: ${detected.length} pressure tactics detected — this site actively tries to manipulate your decisions`
        : dp.score >= 20
          ? `${detected.length} pressure tactic${detected.length > 1 ? 's' : ''} detected: ${detected.map(d => d.type).join(', ')}`
          : 'No pressure tactics or dark patterns detected',
      manipulation_score: dp.score,
      tactics,
    };
  }

  // --- LOCAL DATA (localStorage / sessionStorage tracking) ---
  if (include('storage')) {
    const ls = pageData.storage?.localStorage || { total: 0, flagged: [] };
    const ss = pageData.storage?.sessionStorage || { total: 0, flagged: [] };
    const allFlagged = [...ls.flagged, ...ss.flagged].slice(0, 15);
    const totalKeys = ls.total + ss.total;
    const suspiciousCount = allFlagged.length;

    report.local_data = {
      finding: suspiciousCount > 5
        ? `${suspiciousCount} suspicious tracking identifiers stored on your device out of ${totalKeys} total keys — includes UUIDs, analytics IDs, and session trackers`
        : suspiciousCount > 0
          ? `${suspiciousCount} suspicious key${suspiciousCount > 1 ? 's' : ''} found in ${totalKeys} stored items (${allFlagged.map(f => f.key).join(', ')})`
          : totalKeys > 0
            ? `${totalKeys} items stored locally, none flagged as tracking-related`
            : 'No local data stored',
      total_keys: totalKeys,
      suspicious: suspiciousCount,
      flagged_keys: allFlagged.map(f => ({
        key: f.key,
        why: f.matchedPattern,
        preview: f.valuePreview,
      })),
    };
  }

  // --- LINK TRACKING ---
  if (include('links')) {
    const linkData = pageData.links || { total: 0, with_tracking_params: 0, redirect_wrappers: 0 };
    const pct = linkData.total > 0
      ? Math.round((linkData.with_tracking_params / linkData.total) * 100)
      : 0;

    report.link_tracking = {
      finding: pct > 50
        ? `${pct}% of links (${linkData.with_tracking_params}/${linkData.total}) contain tracking parameters — every click is monitored`
        : linkData.with_tracking_params > 0
          ? `${linkData.with_tracking_params} of ${linkData.total} links have tracking parameters attached`
          : 'No tracking parameters found in links',
      total_links: linkData.total,
      tracked_links: linkData.with_tracking_params,
      redirect_wrappers: linkData.redirect_wrappers,
      tracking_percentage: pct,
      examples: (linkData.details || []).slice(0, 5).map(d => ({
        url: d.href,
        params_found: d.params,
      })),
    };
  }

  // --- VERDICT ---
  report.verdict = computeVerdict(report);

  return report;
}

// --- Verdict ---

function computeVerdict(report) {
  let score = 0;
  const concerns = [];

  // Cookies
  if (report.cookies) {
    const tp = report.cookies.third_party?.count || 0;
    if (tp > 10) { score += 20; concerns.push('Heavy cross-site cookie tracking'); }
    else if (tp > 3) { score += 10; concerns.push('Third-party cookie tracking'); }
    if (report.cookies.persistence?.longest_expiry_days > 365) {
      score += 5; concerns.push('Cookies persist over a year');
    }
  }

  // Trackers
  if (report.trackers) {
    const total = (report.trackers.hidden_pixels || 0) + (report.trackers.beacons || 0) + (report.trackers.hidden_iframes || 0);
    if (total > 10) { score += 25; concerns.push('Heavy hidden tracking infrastructure'); }
    else if (total > 3) { score += 15; concerns.push('Hidden tracking elements present'); }
    if (report.trackers.third_party_scripts > 15) { score += 10; concerns.push('Excessive third-party scripts'); }
  }

  // Fingerprinting
  if (report.fingerprinting) {
    if (report.fingerprinting.techniques_used >= 3) { score += 25; concerns.push('Aggressive device fingerprinting'); }
    else if (report.fingerprinting.techniques_used >= 1) { score += 10; concerns.push('Device fingerprinting detected'); }
  }

  // Pressure
  if (report.pressure) {
    const ps = report.pressure.manipulation_score || 0;
    score += Math.round(ps * 0.2);
    if (ps >= 60) concerns.push('Manipulative dark patterns');
    else if (ps >= 20) concerns.push('Pressure tactics detected');
  }

  // Storage
  if (report.local_data) {
    if (report.local_data.suspicious > 5) { score += 10; concerns.push('Tracking IDs stored locally'); }
  }

  // Links
  if (report.link_tracking) {
    if (report.link_tracking.tracking_percentage > 50) { score += 10; concerns.push('Most links contain tracking parameters'); }
  }

  score = Math.min(score, 100);

  let risk, recommendation;
  if (score <= 15) {
    risk = 'low';
    recommendation = 'This site has minimal privacy concerns. Safe to proceed normally.';
  } else if (score <= 40) {
    risk = 'moderate';
    recommendation = 'Standard tracking detected. Consider using private browsing or clearing cookies after visiting.';
  } else if (score <= 70) {
    risk = 'high';
    recommendation = 'Significant privacy risks. Avoid sharing personal information. Use tracker blocking and consider whether this site is necessary.';
  } else {
    risk = 'critical';
    recommendation = 'This site is aggressively invasive. Avoid entering any personal data. If you must use it, do so in a sandboxed or isolated browser with tracker blocking enabled.';
  }

  return {
    risk,
    score,
    summary: concerns.length > 0
      ? concerns.join('. ') + '.'
      : 'No significant privacy concerns detected.',
    recommendation,
    concerns,
  };
}
