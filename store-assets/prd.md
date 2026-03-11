# wearehere — Product Reference

## Overview

Full privacy scan for every site you visit — one popup, complete picture.

The weare____ suite started as 8 separate browser extensions, each exposing a different privacy concern: cookies, trackers, fingerprinting, dark patterns, ToS toxicity, localStorage tracking, link tracking, and form leaks. wearehere unifies all 8 into one extension with a simplified popup for quick awareness and a full-page dashboard for deep analysis.

wearehere ships two ways:

1. **Browser extension** (Chrome + Firefox) — runs locally in the browser, no AI, no cloud, no accounts.
2. **npm package** (`wearehere` on npm) — exports detection scripts and an `assess()` function so headless browser tools (barebrowse) can integrate privacy assessment as a tool. Zero dependencies.

## What it scans (all 8 modules)

| # | Category | Source module | What it detects |
|---|----------|--------------|-----------------|
| 1 | Cookies | wearecooked | First vs third-party, persistence duration, third-party domains, cookie cleaner |
| 2 | Trackers | wearecooked | Hidden tracking pixels, invisible iframes, sendBeacon calls, third-party scripts — resolved to company names via 258-entry domain map |
| 3 | Fingerprinting | wearewatched | Canvas, WebGL, AudioContext, Navigator, Screen, Battery, Font, Connection API probing via prototype interception |
| 4 | Pressure | weareplayed | Confirm-shaming, fake urgency, countdown timers (with proximity-to-urgency filtering), pre-checked consent boxes, hidden unsubscribe |
| 5 | Terms | wearetosed | Privacy policy and ToS toxicity scoring across 6 categories (data selling, surveillance, retention, law enforcement, rights erosion, unilateral control) |
| 6 | Local data | weareleaking | Suspicious localStorage/sessionStorage keys categorized: cross-site tracking, advertising, fingerprinting, PII exposure, tracking |
| 7 | Link tracking | wearelinked | UTM parameters, fbclid/gclid, redirect wrappers (Google, Facebook, t.co, bit.ly) |
| 8 | Network | wearebaked | Real-time network request monitoring via webRequest API — 454 known tracker domains, 82 data broker profiles, redirect chain detection, domain classification |
| - | Forms | wearesilent | Passive form field detection (Method B) — finds visible input/textarea/select fields, resolves labels, checks for tracker presence while forms are active |

## How it works

### Browser extension

#### Fingerprinting & beacon detection (inject.js, from wearewatched)
- Runs in `MAIN` world at `document_start` — before any page script
- Wraps prototype methods: `HTMLCanvasElement.toDataURL`, `WebGLRenderingContext.getParameter`, `AudioContext.createOscillator`, `navigator.hardwareConcurrency/languages/platform/deviceMemory`, `screen.colorDepth/pixelDepth`
- Wraps `navigator.sendBeacon` to intercept beacon calls
- Relays detections to content script via `postMessage`

#### DOM scanning (content.js)
- Runs at `document_start`, scans after page load
- **Trackers (wearecooked)**: 258-entry COMPANY_MAP with `lookupCompany()` subdomain walking — resolves raw domains to company names and purposes (Advertising, Analytics, Data broker, etc.)
- Tracking pixels: 1x1 or hidden `<img>` elements from known tracker domains
- Hidden iframes: zero-size or hidden `<iframe>` elements
- **Dark patterns (weareplayed)**: text heuristics on button/link text (confirm-shaming), body text (fake urgency, countdown timers), checkbox state (pre-checked boxes), computed styles (hidden unsubscribe). Timer false positive fix: requires `HH:MM:SS` pattern to be within 300 chars of urgency language
- **Storage (weareleaking)**: scans localStorage/sessionStorage keys against categorized SUSPICIOUS_PATTERNS — Cross-site tracking, Advertising, Fingerprinting, PII exposure, Tracking
- **Links (wearelinked)**: checks all `<a href>` for 16 tracking parameters and 6 redirect wrapper domains
- **Forms (wearesilent Method B)**: passive detection — finds visible input/textarea/select fields, resolves labels via 6-level resolution (aria-labelledby, aria-label, label[for], wrapping label, placeholder, name/id), deduplicates
- MutationObserver re-scans on dynamic content changes
- Finds ToS/privacy links on the page and sends them to background for scanning
- Content-script-side ToS fetch fallback for SPAs (Reddit, etc.) — fetches with page cookies/session when background fetch returns empty shell

#### ToS scanning (background.js + tos-scanner.js, from wearetosed)
- Tries 20+ common paths (`/privacy`, `/terms`, `/policies/privacy-policy`, etc.)
- Falls back to links found on the page by content.js
- Fetches HTML, strips tags, runs wearetosed's `scanText()` — 54 regex patterns across 6 categories
- Follows meta refresh redirects (Google pattern)
- Scans both privacy policy AND terms of service separately, combines scores
- Content-script fallback: if background fetch fails (SPA empty shell), sends `fetchToS` message to content script which fetches with page credentials
- Caches results per domain

#### Network monitoring (background.js + network-domains.js, from wearebaked)
- Uses `chrome.webRequest` API (observation-only, non-blocking) for real-time network monitoring
- Listeners: `onBeforeRequest` (timing, redirect chains, request body size), `onBeforeRedirect` (chain appending), `onCompleted` (domain classification, bytes, per-tab tracking), `onErrorOccurred` (cleanup)
- **network-domains.js** contains: 454 NET_TRACKER_DOMAINS (categorized: Advertising, Analytics, Social Tracking, Fingerprinting, Data Broker, Error Monitoring, A/B Testing, Chat/Support, Video/Media, Consent, Email/CRM), 82 NET_BROKER_META profiles with name/type/description, NET_PURPOSE_DOMAINS (benign: CDN, fonts, captcha, payment, auth, maps), NET_DOMAIN_PATTERNS (regex fallback)
- 3-pass domain classification: (1) exact domain DB, (2) pattern regex, (3) request heuristics (tracking pixels by content-length, beacon POSTs by empty response)
- Per-tab network data: requestCount, thirdPartyDomains, categories, brokers, bytes

#### Cookie analysis (background.js)
- Uses `chrome.cookies.getAll()` for complete cookie inventory including HttpOnly
- Classifies first-party vs third-party by domain matching
- Tracks persistence: session vs persistent, longest expiry in days
- Cookie cleaner: `cleanCookies` message handler supports 'all' and 'thirdParty' modes via `chrome.cookies.remove()`

#### Verdict
- Scores 0-100 based on weighted findings across all 8 categories
- Risk levels: low (0-15), moderate (16-40), high (41-70), critical (71-100)
- Scoring includes: cookies (third-party count + persistence), trackers (count + scripts), fingerprinting (technique count), pressure (manipulation score), terms (toxicity score), storage (suspicious keys), links (tracking percentage), network (data broker count), forms (trackers watching while typing)
- Plain-language recommendation for each level

### npm package (assess/)

The `wearehere` npm package exports the same detection logic for use in headless browser environments. It is consumed by barebrowse as an optional dependency, adding an `assess` tool alongside barebrowse's 12 existing MCP tools. No separate MCP server needed.

#### Architecture

**Before (deprecated)**: wearehere had its own MCP server (`mcp-server.js`) that imported barebrowse as a dependency. This was awkward — users needed to configure two MCP servers.

**After**: wearehere publishes a zero-dependency npm package. barebrowse lists it as an `optionalDependency` and dynamically imports it. If `wearehere` is installed, barebrowse exposes a 13th `assess` tool. If not, barebrowse works normally with its 12 tools. The dependency flows one way: barebrowse depends on wearehere, never the reverse.

#### assess(page, url, opts)

The main entry point. Takes a barebrowse `page` object (not a URL) — wearehere does not manage browser lifecycle, barebrowse does.

Steps:
1. Injects init scripts (fingerprint/beacon wrappers from `getInitScript()`) before navigation
2. Navigates to URL, waits for network to settle
3. Runs page scripts (cookies, trackers, dark patterns, storage, links, ToS detection from `getPageScript()`)
4. Collects results from the page context
5. Computes verdict via `computeVerdict()` — same 10-category weighted scoring as the extension
6. Returns compact structured JSON

#### Compact output shape

```json
{
  "site": "example.com",
  "url": "https://example.com",
  "score": 62,
  "risk": "high",
  "recommendation": "Significant privacy risks. Avoid sharing personal info.",
  "concerns": ["Heavy hidden tracking", "Aggressive device fingerprinting"],
  "categories": {
    "cookies":      { "score": 10, "max": 15, "summary": "7 third-party cookies" },
    "network":      { "score": 5,  "max": 10, "summary": "5 tracker domains" },
    "trackers":     { "score": 20, "max": 20, "summary": "14 hidden elements" },
    "pressure":     { "score": 0,  "max": 15, "summary": "No dark patterns" },
    "selling_data": { "score": 5,  "max": 10, "summary": "2 broker connections" },
    "profiling":    { "score": 10, "max": 20, "summary": "Canvas + WebGL" },
    "stored_data":  { "score": 0,  "max": 5,  "summary": "No suspicious keys" },
    "watching":     { "score": 0,  "max": 10, "summary": "No form surveillance" },
    "clicks":       { "score": 5,  "max": 5,  "summary": "68% of links tracked" },
    "terms":        { "score": 15, "max": 15, "summary": "Binding arbitration" }
  },
  "scanned_at": "2026-03-11T..."
}
```

The output is designed for agent threshold decisions (compact, structured) rather than verbose human-readable reports.

#### Sub-path exports

| Import path | What it provides |
|-------------|-----------------|
| `wearehere` | `assess(page, url, opts)` — full assessment |
| `wearehere/scripts` | `getInitScript()`, `getPageScript()` — raw detection scripts for custom integration |
| `wearehere/scoring` | `computeVerdict(results)` — scoring engine only |
| `wearehere/data` | Tracker domains, broker metadata, `scanText()`, `classifyNetworkDomain()` — raw data |

#### Package modules

| File | Purpose |
|------|---------|
| `index.js` | `assess(page, url, opts)` — orchestrates injection, navigation, collection, scoring |
| `scripts.js` | `getInitScript()` (fingerprint/beacon wrappers), `getPageScript()` (DOM scanners) |
| `data.js` | Tracker domains, patterns, broker data, ToS patterns — same data as the extension |
| `scoring.js` | `computeVerdict()` — 10-category weighted scoring system, same weights as extension |

#### How barebrowse integrates

```json
// barebrowse package.json
{ "optionalDependencies": { "wearehere": "^1.0.0" } }
```

- Dynamic import with fallback: `try { wearehere = await import('wearehere') } catch { /* assess tool not available */ }`
- Adds `assess` as 13th MCP tool alongside goto, click, snapshot, scroll, type, press, back, forward, browse, drag, upload, pdf
- Also registered in `bareagent.js` tools array for agent use

## Module reuse

wearehere does not reinvent detection logic. It reuses the actual scanner modules from each extension:

| File in wearehere | Source | Version |
|-------------------|--------|---------|
| `tos-scanner.js` | wearetosed `scanner.js` | v0.1.0 |
| `inject.js` prototype wrappers | wearewatched `inject.js` | v0.1.0 |
| `content.js` COMPANY_MAP (258 entries) | wearecooked `content.js` | v4.0.0 |
| `content.js` dark pattern heuristics | weareplayed `content.js` | v0.1.0 |
| `content.js` categorized storage patterns | weareleaking `content.js` | v0.2.0 |
| `content.js` tracking params | wearelinked `content.js` | v0.3.0 |
| `network-domains.js` (454 domains, 82 brokers) | wearebaked `background.js` | v0.5.1 |
| `content.js` form scanning (Method B) | wearesilent `content.js` | v0.1.0 |

When a source extension updates, wearehere should pull the updated module.

## UI

### Popup (400px wide, dark theme)
Simplified display for regular users — shows what matters at a glance.

- **Header**: site name + risk score badge (colored by level)
- **Risk bar**: gradient bar showing score 0-100
- **Summary**: one-line recommendation
- **8 sections** (each with icon, label, headline value, and detail):
  1. Cookies — count, 1st/3rd party split, longest expiry
  2. Trackers — company count (resolved names, not raw domains), top 4 names shown
  3. Fingerprinting — "Active"/"None" with plain sentence description
  4. Pressure — manipulation score, tactic list with evidence quotes
  5. Terms — toxicity score, flagged categories
  6. Stored on you — suspicious key count by category name
  7. Links — tracking percentage, redirect wrappers
  8. Forms — field count, trackers watching while you type
- **Full Report button**: opens the unified dashboard (report.html) in a new tab

### Dashboard (report.html, full-page, 5 tabs)
Deep-dive analysis for users who want details.

- **Overview tab**: risk score display with bar, score breakdown by category, concerns list, at-a-glance summary grid
- **Cookies tab**: summary cards (total, first/third party, longest expiry), first/third-party ratio bar, insights row, worst offenders with reason tags, category bars, searchable/sortable cookie table, cookie cleaner (Clean Third-Party / Clean All)
- **Network tab**: summary cards, privacy summary sentence + bar, category bars, domain grid, 7 collapsible sections (Data Brokers, Beaconing Alerts, New Domains, Redirect Chains, Data Flow, WebSockets, Live Feed) — each shows count before expanding
- **Terms tab**: split Privacy Policy + Terms of Service sections, each with own score (/100) and categorized breakdowns (Data practices: sharing/selling, tracking/profiling, retention; Your rights: law enforcement, liability waivers, unilateral changes)
- **Tracking tab**: combines 4 sections, each with icon + header + inline count:
  - Fingerprinting (`· N techniques`): categorized rows with friendly API names and call counts
  - Forms (`· N trackers`): tracked field names, company pills
  - Storage (`· N of M suspicious`): categories with count-first layout (`20 Cross-site tracking`), left orange border, service name chips (Google Analytics, Hotjar, TikTok, etc.) instead of raw key names, unrecognized keys as "N others"
  - Links (`· N of M tracked`): summary grid, highlighted tracking params

### Badge
- Shows overall risk score (0-100)
- Color: green (low), orange (moderate), red (high/critical)

## Permissions

| Permission | Why |
|-----------|-----|
| `activeTab` | Badge updates on current tab |
| `storage` | Persist scan results |
| `cookies` | Read full cookie inventory via API, cookie cleaner |
| `webRequest` | Network traffic monitoring (observation-only, non-blocking) |
| `<all_urls>` (host) | Content scripts on all pages, ToS page fetching, network monitoring |

## Project structure

```
wearehere/
├── assess/                        # npm package (published as "wearehere")
│   ├── package.json               # name: "wearehere", zero dependencies
│   ├── index.js                   # assess(page, url, opts) → compact JSON
│   ├── scripts.js                 # getInitScript(), getPageScript()
│   ├── data.js                    # tracker domains, patterns, broker data, ToS patterns
│   └── scoring.js                 # computeVerdict() — 10-category weighted system
├── chrome-extension/              # Browser extension
│   ├── manifest.json              # MV3, v3.1.1
│   ├── background.js              # Aggregator + verdict + badge
│   ├── inject.js                  # Fingerprint/beacon wrappers (MAIN world)
│   ├── detect-cooked.js           # Tracker detection
│   ├── detect-leaked.js           # Storage scanning
│   ├── detect-linked.js           # Link tracking
│   ├── detect-played.js           # Dark patterns
│   ├── detect-silent.js           # Form scanning
│   ├── detect-tosed.js            # ToS link finder
│   ├── detect-watched.js          # Fingerprint relay
│   ├── tos-scanner.js             # scanText() patterns
│   ├── network-domains.js         # 454 trackers, 82 brokers
│   ├── popup.html/js/css          # Quick-view popup
│   └── report.html/js/css         # Full dashboard
├── firefox-extension/             # Browser extension (Firefox MV2)
│   ├── manifest.json              # MV2, v3.1.1, browser_specific_settings
│   ├── background.js              # Aggregator (browser.* API, promise-based, ETP handling)
│   ├── inject.js                  # Fingerprint/beacon wrappers (page context)
│   ├── detect-*.js                # Detection modules (browser.runtime API)
│   ├── tos-scanner.js             # scanText() patterns
│   ├── network-domains.js         # 454 trackers, 82 brokers
│   ├── popup.html/js/css          # Quick-view popup
│   └── report.html/js/css         # Full dashboard
└── store-assets/                  # Store listings, PRD
```

## Changelog

### v4.0.1 — Firefox store linter fixes

- Added `data_collection_permissions` to Firefox manifest (`required: ["none"]`, `optional: ["technicalAndInteraction"]`)
- Bumped `strict_min_version` from 109.0 to 142.0 (required for `data_collection_permissions` support on Firefox for Android)
- Replaced all `innerHTML` assignments in popup.js and report.js with safe alternatives:
  - Clearing: `el.innerHTML = ''` → `el.textContent = ''`
  - HTML insertion: `el.innerHTML = '<html>'` → `DOMParser` + `adoptNode` or `el()` with `textContent`
  - Renamed `innerHTML` key in `el()` helper to `_html` to avoid linter string detection
- Updated `wearehere-firefox.zip`

### v4.0.0 — npm package, MCP server deprecated

- New `assess/` directory: standalone npm package published as `wearehere` on npm
- Exports `assess(page, url, opts)` for headless browser integration — takes a barebrowse page object, returns compact privacy assessment JSON
- Sub-path exports: `wearehere/scripts` (init + page scripts), `wearehere/scoring` (verdict engine)
- Same 10-category weighted scoring as the extension (cookies, network, trackers, pressure, selling data, profiling, stored data, watching, clicks, terms)
- Zero dependencies — barebrowse consumes it as an optionalDependency
- Deprecated standalone MCP server (`mcp-server.js` + `src/`) — barebrowse now exposes `assess` as its 13th MCP tool directly, no second server needed
- Compact output shape designed for agent threshold decisions (score, risk, concerns, per-category breakdown)

### v3.1.1 — Content Script Scope Isolation

- Wrapped detect-cooked, detect-linked, detect-leaked, and detect-silent in IIFEs to prevent global variable collisions
- Root cause: Chrome content scripts from the same extension share the same isolated world scope — `var items`, `sendResults`, `getDomain`, `scanElement`, and `observer` in detect-cooked.js and detect-linked.js were overwriting each other
- Fixes: `Cannot read properties of undefined (reading 'length')` crashes on pages with links and trackers

### v3.1.0 — Dashboard Polish, Unified Labels, Score Rebalance

**Unified 10-Section Labels**
- Consistent naming across popup, overview, and tracking tab: Cookies, Network, Trackers, Pressure, Selling data, Profiling, Stored data, Watching, Clicks, Terms
- Extension icons replace emojis in popup sections
- Extension icons added to overview summary cards and score breakdown rows

**Dark Patterns Section**
- New "Tricking you into buying" card in Tracking tab (7th section)
- Shows manipulation score, detected tactics (countdown timers, discount pressure, scarcity, pre-checked boxes, confirm-shaming, hidden unsubscribe)
- Data from weareplayed module now fully integrated

**Score Rebalance**
- Rebalanced category weights: Trackers 20, Profiling 20, Cookies 15, Pressure 15, Terms 15, Network 10, Selling data 10, Watching 10, Stored data 5, Clicks 5
- Terms scoring improved: 3 tiers (+5/+10/+15) instead of 2 (+5/+10)
- Selling data now contributes to score based on broker count
- Network tracker domains now contribute to verdict score

**Visual Consistency**
- Stacked weight bar shows all 10 category weights on a single 100% scale
- Category colors consistent across weight bar, breakdown rows, At a Glance cards, and Tracking tab headers
- Breakdown rows show +pts / max for transparency
- At a Glance cards have colored left borders matching category colors
- Overview reordered: Score → At a Glance (with Concerns card) → Breakdown
- Concerns card spans 2 columns inside At a Glance grid with red left border

**Network in Popup**
- Network summary (tracker domains, request count, third-party domains) now available in popup via buildReport()
- Selling data section in popup shows broker count from network data

### v3.0.0
- Dashboard consolidated from 8 tabs → 5: Overview, Cookies, Network, Terms, Tracking
- New Tracking tab combines Fingerprinting, Forms, Storage, Links in one view
- Each tracking section has icon + header with inline count (e.g. `· 37 of 151 suspicious`)
- Terms tab split: separate Privacy Policy and Terms of Service sections with individual scores
- Storage: service name resolution — raw keys like `_ga`, `TT_UID` resolved to company names (Google Analytics, TikTok, etc.) via 30+ pattern map, shown as chips with counts
- Storage: count-first layout (`20 Cross-site tracking`) with left orange border
- Forms: company names in pills, "Tracked fields" subheader for clarity
- Fingerprinting: friendly API descriptions, removed redundant verdict (covered by header count)
- Network: collapsible sections show counts before expanding (`N brokers · click to expand`)
- Icons: original extension icons reused in tab bar (16px) and section headers (20px)
- App icon: eye-recognition.png with white circle background (16/48/128px)
- Responsive CSS: 768px and 480px breakpoints, no min-width constraints
- Monolithic content.js split into 7 detect-*.js modules
- detect-watched.js: try/catch on sendMessage for MV3 service worker race condition

### v2.0.0
- All 8 weare____ extensions integrated — no companion extensions needed
- New: network monitoring via webRequest API (from wearebaked v0.5.1) — 454 tracker domains, 82 data broker profiles, redirect chain detection
- New: form field scanning (from wearesilent Method B) — passive detection of form fields + tracker presence
- New: unified dashboard (report.html) with 8 tabs — Overview, Cookies, Network, Trackers, Terms, Data, Fingerprinting, Forms
- New: cookie cleaner in dashboard (Clean Third-Party / Clean All)
- Tracker company names via wearecooked's 258-entry COMPANY_MAP with subdomain walking
- Storage categories from weareleaking (Cross-site tracking, Advertising, Fingerprinting, PII exposure, Tracking)
- Timer false positive fix: countdown patterns require proximity to urgency language
- ToS SPA fix: content-script-side fetch fallback for SPAs like Reddit
- Popup simplified to 8 sections with casual language for regular users
- Full Report button in popup opens dashboard

### v1.0.2
- Tracker display fixed: shows company names instead of raw domains
- Storage display: shows categories instead of raw key names
- ToS fix: content-script fallback for SPA pages
- Timer false positive fix: YouTube countdown detection

### v1.0.1
- inject.js runs in `MAIN` world via manifest (guaranteed before page scripts)
- ToS scanner uses wearetosed's actual `scanText()` with 54 regex patterns
- ToS fetcher tries 20+ paths + page-found links, scans both privacy and terms
- Meta refresh redirect following (Google pattern)
- Domain-level ToS caching
- Tab data persists across same-domain navigation and window switches
- Content script finds privacy/terms links on page for background fallback
