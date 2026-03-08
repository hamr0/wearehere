/**
 * data.js — Tracker domains, dark pattern phrases, ToS patterns, fingerprint APIs.
 * Ported from the weare____ extension suite.
 */

// --- Tracker domains (from wearecooked v3.0.0, 170+ domains condensed to top patterns) ---

export const TRACKER_DOMAINS = [
  // Google
  'google-analytics.com', 'googletagmanager.com', 'googleadservices.com',
  'googlesyndication.com', 'doubleclick.net', 'google.com/pagead',
  'googletagservices.com', 'googleapis.com/log',
  // Meta
  'facebook.net', 'facebook.com/tr', 'fbcdn.net', 'connect.facebook.net',
  'meta.com',
  // Microsoft
  'clarity.ms', 'bing.com/bat', 'bat.bing.com',
  // Amazon
  'amazon-adsystem.com', 'assoc-amazon.com',
  // Twitter/X
  'platform.twitter.com', 'analytics.twitter.com', 't.co',
  // Analytics & session replay
  'hotjar.com', 'fullstory.com', 'mouseflow.com', 'luckyorange.com',
  'smartlook.com', 'logrocket.com', 'heap-analytics.com',
  'mixpanel.com', 'segment.io', 'segment.com', 'amplitude.com',
  'optimizely.com', 'crazyegg.com',
  // Ad networks
  'criteo.com', 'outbrain.com', 'taboola.com', 'adroll.com',
  'quantserve.com', 'scorecardresearch.com', 'bluekai.com',
  'rubiconproject.com', 'pubmatic.com', 'openx.net',
  'casalemedia.com', 'adsrvr.org', 'adnxs.com',
  // Consent / CMP
  'cookiebot.com', 'onetrust.com', 'trustarc.com',
  // Data brokers
  'acxiom.com', 'oracle.com/cx', 'liveramp.com',
  'lotame.com', 'bombora.com', 'intentiq.com',
  // CDN-disguised trackers
  'cdn.mxpnl.com', 'cdn.heapanalytics.com', 'cdn.segment.com',
  // Misc
  'newrelic.com', 'nr-data.net', 'sentry.io',
  'bugsnag.com', 'datadoghq.com',
];

// --- URL patterns for tracker classification ---

export const TRACKER_URL_PATTERNS = [
  { pattern: /google-analytics|googletagmanager|gtag/, company: 'Google', purpose: 'Analytics' },
  { pattern: /doubleclick|googlesyndication|googleadservices|pagead/, company: 'Google', purpose: 'Advertising' },
  { pattern: /facebook\.net|facebook\.com\/tr|fbcdn|connect\.facebook/, company: 'Meta', purpose: 'Tracking' },
  { pattern: /clarity\.ms/, company: 'Microsoft', purpose: 'Session Replay' },
  { pattern: /hotjar/, company: 'Hotjar', purpose: 'Session Replay' },
  { pattern: /fullstory/, company: 'FullStory', purpose: 'Session Replay' },
  { pattern: /mixpanel/, company: 'Mixpanel', purpose: 'Analytics' },
  { pattern: /segment\.(io|com)/, company: 'Segment', purpose: 'Analytics' },
  { pattern: /amplitude/, company: 'Amplitude', purpose: 'Analytics' },
  { pattern: /criteo/, company: 'Criteo', purpose: 'Advertising' },
  { pattern: /outbrain/, company: 'Outbrain', purpose: 'Advertising' },
  { pattern: /taboola/, company: 'Taboola', purpose: 'Advertising' },
  { pattern: /adnxs|adsrvr|adroll/, company: 'Ad Network', purpose: 'Advertising' },
  { pattern: /newrelic|nr-data/, company: 'New Relic', purpose: 'Monitoring' },
  { pattern: /sentry\.io/, company: 'Sentry', purpose: 'Error Tracking' },
  { pattern: /optimizely/, company: 'Optimizely', purpose: 'A/B Testing' },
];

// --- Dark pattern phrases (from weareplayed) ---

export const DARK_PATTERNS = {
  confirm_shaming: [
    'no thanks, i don\'t want',
    'no, i prefer to',
    'i\'ll pass on',
    'no thanks, i\'d rather',
    'i don\'t want to save',
    'no, i hate saving',
    'i prefer paying full price',
    'no, keep me uninformed',
    'i don\'t like deals',
  ],
  fake_urgency: [
    'only \\d+ left',
    '\\d+ people (are )?(viewing|looking|watching)',
    'limited time offer',
    'offer expires',
    'hurry',
    'act now',
    'don\'t miss out',
    'selling fast',
    'almost gone',
    'last chance',
    'ends (today|tonight|soon|in)',
    'while supplies last',
    'order within',
  ],
  countdown_timer: [
    '\\d+\\s*:\\s*\\d+\\s*:\\s*\\d+',
    '\\d+h\\s*\\d+m',
    '\\d+ hours? \\d+ min',
    'minutes? (and|&) \\d+ seconds?',
  ],
  pre_checked: [], // detected via DOM inspection, not text
  hidden_unsubscribe: [], // detected via DOM/CSS inspection, not text
};

// --- Suspicious localStorage key patterns (from weareleaking) ---

export const SUSPICIOUS_STORAGE_PATTERNS = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, // UUID
  /^_ga/,
  /^_fb/,
  /^_gcl/,
  /track/i,
  /^uid$/i,
  /^userid$/i,
  /analytics/i,
  /^mp_/,       // mixpanel
  /^ajs_/,      // segment
  /^amplitude/i,
  /^optimizely/i,
  /^_hjid/,     // hotjar
  /^intercom/i,
  /^__stripe/i,
  /session.?id/i,
  /visitor.?id/i,
  /device.?id/i,
];

// --- Tracking URL parameters (from wearelinked) ---

export const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_eid', 'mc_cid', 'oly_enc_id', 'oly_anon_id',
  '_hsenc', '_hsmi', 'hsa_cam', 'hsa_grp', 'hsa_mt',
  'vero_id', 'wickedid', 'twclid',
  'igshid', 'si', // instagram, spotify
  'ref', 'ref_', 'referrer',
];

// --- Redirect wrapper domains (from wearelinked) ---

export const REDIRECT_WRAPPERS = [
  { domain: 'google.com/url', param: 'q' },
  { domain: 'l.facebook.com', param: 'u' },
  { domain: 'lm.facebook.com', param: 'u' },
  { domain: 't.co', param: null }, // shortener, no param extraction
  { domain: 'bit.ly', param: null },
  { domain: 'tinyurl.com', param: null },
  { domain: 'ow.ly', param: null },
  { domain: 'buff.ly', param: null },
];

// --- Fingerprint API signatures (from wearewatched) ---

export const FINGERPRINT_APIS = [
  { name: 'Canvas', method: 'HTMLCanvasElement.prototype.toDataURL' },
  { name: 'Canvas', method: 'HTMLCanvasElement.prototype.toBlob' },
  { name: 'Canvas', method: 'CanvasRenderingContext2D.prototype.getImageData' },
  { name: 'WebGL', method: 'WebGLRenderingContext.prototype.getParameter' },
  { name: 'WebGL', method: 'WebGL2RenderingContext.prototype.getParameter' },
  { name: 'AudioContext', method: 'AudioContext.prototype.createOscillator' },
  { name: 'AudioContext', method: 'OfflineAudioContext.prototype.startRendering' },
  { name: 'Navigator', method: 'navigator.hardwareConcurrency' },
  { name: 'Navigator', method: 'navigator.languages' },
  { name: 'Navigator', method: 'navigator.platform' },
  { name: 'Navigator', method: 'navigator.deviceMemory' },
  { name: 'Screen', method: 'screen.colorDepth' },
  { name: 'Screen', method: 'screen.pixelDepth' },
];
