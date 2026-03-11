/**
 * scoring.js — 10-category weighted verdict system.
 *
 * Matches the browser extension's computeVerdict() exactly.
 * Weights: Trackers 20, Profiling 20, Cookies 15, Pressure 15,
 *          Terms 15, Network 10, Selling data 10, Watching 10,
 *          Stored data 5, Clicks 5.
 */

/**
 * Compute privacy verdict from a normalized report.
 *
 * @param {object} r - Report object with category data
 * @returns {{ score, risk, recommendation, concerns, categories }}
 */
export function computeVerdict(r) {
  let score = 0;
  const concerns = [];
  const categories = {};

  // Cookies (max 15)
  let cookieScore = 0;
  let cookieSummary = 'No cookies';
  if (r.cookies) {
    const tp = r.cookies.thirdParty || 0;
    const longest = r.cookies.longestDays || 0;
    if (tp > 10) { cookieScore = 15; concerns.push('Heavy cross-site cookie tracking'); }
    else if (tp > 3) { cookieScore = 10; concerns.push('Third-party cookies tracking you'); }
    else if (longest > 365) { cookieScore = 5; concerns.push('Cookies last over a year'); }

    if (tp > 0) cookieSummary = `${tp} third-party cookies`;
    else if (r.cookies.total > 0) cookieSummary = `${r.cookies.total} first-party only`;
  }
  categories.cookies = { score: cookieScore, max: 15, summary: cookieSummary };
  score += cookieScore;

  // Network (max 10)
  let networkScore = 0;
  let networkSummary = 'No tracker domains';
  if (r.network) {
    const td = r.network.trackerDomains || 0;
    if (td > 10) { networkScore = 10; concerns.push('Many tracker domains in network traffic'); }
    else if (td > 3) { networkScore = 5; concerns.push('Tracker domains detected'); }
    if (td > 0) networkSummary = `${td} tracker domains`;
  }
  categories.network = { score: networkScore, max: 10, summary: networkSummary };
  score += networkScore;

  // Trackers (max 20)
  let trackerScore = 0;
  let trackerSummary = 'No hidden trackers';
  if (r.trackers) {
    const total = r.trackers.total || 0;
    if (total > 10) { trackerScore = 20; concerns.push('Heavy hidden tracking'); }
    else if (total > 3) { trackerScore = 10; concerns.push('Hidden trackers on this page'); }
    if (total > 0) trackerSummary = `${total} hidden tracking elements`;
  }
  categories.trackers = { score: trackerScore, max: 20, summary: trackerSummary };
  score += trackerScore;

  // Pressure (max 15)
  let pressureScore = 0;
  let pressureSummary = 'No dark patterns';
  if (r.pressure) {
    const ps = r.pressure.score || 0;
    if (ps >= 60) { pressureScore = 15; concerns.push('Using manipulative design tricks'); }
    else if (ps >= 20) { pressureScore = 5; concerns.push('Some pressure tactics'); }
    if (ps > 0) pressureSummary = `Manipulation score ${ps}`;
  }
  categories.pressure = { score: pressureScore, max: 15, summary: pressureSummary };
  score += pressureScore;

  // Selling data (max 10)
  let sellingScore = 0;
  let sellingSummary = 'No data brokers';
  if (r.network) {
    const bc = r.network.brokerCount || 0;
    if (bc > 5) { sellingScore = 10; concerns.push('Data brokers found in network traffic'); }
    else if (bc > 0) { sellingScore = 5; concerns.push('Data broker connections detected'); }
    if (bc > 0) sellingSummary = `${bc} broker connections`;
  }
  categories.selling_data = { score: sellingScore, max: 10, summary: sellingSummary };
  score += sellingScore;

  // Profiling (max 20)
  let profilingScore = 0;
  let profilingSummary = 'No fingerprinting';
  if (r.fingerprinting) {
    const tech = r.fingerprinting.techniques || 0;
    if (tech >= 3) { profilingScore = 20; concerns.push('Aggressively fingerprinting your device'); }
    else if (tech >= 1) { profilingScore = 10; concerns.push('Reading your device info'); }
    if (tech > 0) {
      const names = r.fingerprinting.techniqueNames || [];
      profilingSummary = names.length > 0 ? names.join(' + ') : `${tech} techniques`;
    }
  }
  categories.profiling = { score: profilingScore, max: 20, summary: profilingSummary };
  score += profilingScore;

  // Stored data (max 5)
  let storedScore = 0;
  let storedSummary = 'No suspicious keys';
  if (r.localData) {
    const sus = r.localData.suspicious || 0;
    if (sus > 5) { storedScore = 5; concerns.push('Tracking IDs saved on your device'); }
    if (sus > 0) storedSummary = `${sus} suspicious keys`;
  }
  categories.stored_data = { score: storedScore, max: 5, summary: storedSummary };
  score += storedScore;

  // Watching (max 10)
  let watchingScore = 0;
  let watchingSummary = 'No form surveillance';
  if (r.forms) {
    const fc = r.forms.fieldCount || 0;
    const tw = r.forms.trackersWhileTyping || 0;
    if (fc > 0 && tw > 3) {
      watchingScore = 10;
      concerns.push('Trackers watching while you fill out forms');
    }
    if (fc > 0) watchingSummary = `${fc} fields, ${tw} trackers active`;
  }
  categories.watching = { score: watchingScore, max: 10, summary: watchingSummary };
  score += watchingScore;

  // Clicks (max 5)
  let clicksScore = 0;
  let clicksSummary = 'No link tracking';
  if (r.linkTracking) {
    const pct = r.linkTracking.percentage || 0;
    if (pct > 50) { clicksScore = 5; concerns.push('Most links tag your clicks'); }
    if (pct > 0) clicksSummary = `${pct}% of links tracked`;
  }
  categories.clicks = { score: clicksScore, max: 5, summary: clicksSummary };
  score += clicksScore;

  // Terms (max 15)
  let termsScore = 0;
  let termsSummary = 'Not scanned';
  if (r.tos) {
    const ts = r.tos.score || 0;
    if (ts >= 60) { termsScore = 15; concerns.push('Toxic terms of service'); }
    else if (ts >= 30) { termsScore = 10; concerns.push('Concerning terms'); }
    else if (ts >= 10) { termsScore = 5; concerns.push('Some concerning terms'); }
    if (r.tos.found === false) termsSummary = 'No policy found';
    else if (ts > 0) {
      const flagged = r.tos.flagged || [];
      termsSummary = flagged.length > 0 ? flagged.map(f => f.pattern).join(', ') : `Toxicity score ${ts}`;
    } else {
      termsSummary = 'Clean terms';
    }
  }
  categories.terms = { score: termsScore, max: 15, summary: termsSummary };
  score += termsScore;

  score = Math.min(score, 100);

  let risk, recommendation;
  if (score <= 15) {
    risk = 'low';
    recommendation = 'This site is fairly clean. Browse normally.';
  } else if (score <= 40) {
    risk = 'moderate';
    recommendation = 'Typical tracking. Private browsing or clearing cookies helps.';
  } else if (score <= 70) {
    risk = 'high';
    recommendation = 'Significant privacy risks. Avoid sharing personal info here.';
  } else {
    risk = 'critical';
    recommendation = 'Very invasive. Use tracker blocking or avoid this site.';
  }

  return { score, risk, recommendation, concerns, categories };
}
