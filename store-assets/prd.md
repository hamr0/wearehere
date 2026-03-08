# wearehere — Product Reference

## Overview

Full privacy scan for every site you visit — one popup, complete picture.

The weare____ suite started as 8 separate browser extensions, each exposing a different privacy concern: cookies, trackers, fingerprinting, dark patterns, ToS toxicity, localStorage tracking, link tracking, and form leaks. wearehere unifies all of them into one extension with a single popup that scans every page you visit and gives you an instant risk score.

No AI, no cloud, no accounts — everything runs locally in your browser.

## What it scans

| Category | Source module | What it detects |
|----------|--------------|-----------------|
| Cookies | wearecooked | First vs third-party, persistence duration, third-party domains |
| Trackers | wearecooked | Hidden tracking pixels, invisible iframes, sendBeacon calls, third-party scripts |
| Fingerprinting | wearewatched | Canvas, WebGL, AudioContext, Navigator, Screen API probing via prototype interception |
| Pressure | weareplayed | Confirm-shaming, fake urgency, countdown timers, pre-checked consent boxes, hidden unsubscribe |
| Terms | wearetosed | Privacy policy and ToS toxicity scoring across 6 categories (data selling, surveillance, retention, law enforcement, rights erosion, unilateral control) |
| Local data | weareleaking | Suspicious localStorage/sessionStorage keys (UUIDs, tracking IDs, analytics tokens) |
| Link tracking | wearelinked | UTM parameters, fbclid/gclid, redirect wrappers (Google, Facebook, t.co, bit.ly) |

## How it works

### Fingerprinting & beacon detection (inject.js, from wearewatched)
- Runs in `MAIN` world at `document_start` — before any page script
- Wraps prototype methods: `HTMLCanvasElement.toDataURL`, `WebGLRenderingContext.getParameter`, `AudioContext.createOscillator`, `navigator.hardwareConcurrency/languages/platform/deviceMemory`, `screen.colorDepth/pixelDepth`
- Wraps `navigator.sendBeacon` to intercept beacon calls
- Relays detections to content script via `postMessage`

### DOM scanning (content.js, from wearecooked/weareplayed/weareleaking/wearelinked)
- Runs at `document_start`, scans after page load
- Tracking pixels: 1x1 or hidden `<img>` elements from 60+ known tracker domains
- Hidden iframes: zero-size or hidden `<iframe>` elements
- Dark patterns: text heuristics on button/link text (confirm-shaming), body text (fake urgency, countdown timers), checkbox state (pre-checked boxes), computed styles (hidden unsubscribe)
- Storage: scans localStorage/sessionStorage keys against 14 suspicious patterns (UUIDs, `_ga`, `_fb`, `session.?id`, etc.)
- Links: checks all `<a href>` for 16 tracking parameters and 6 redirect wrapper domains
- MutationObserver re-scans on dynamic content changes
- Finds ToS/privacy links on the page and sends them to background for scanning

### ToS scanning (background.js + tos-scanner.js, from wearetosed)
- Tries 20+ common paths (`/privacy`, `/terms`, `/policies/privacy-policy`, etc.)
- Falls back to links found on the page by content.js
- Fetches HTML, strips tags, runs wearetosed's `scanText()` — 54 regex patterns across 6 categories
- Follows meta refresh redirects (Google pattern)
- Scans both privacy policy AND terms of service separately, combines scores
- Caches results per domain

### Cookie analysis (background.js)
- Uses `chrome.cookies.getAll()` for complete cookie inventory including HttpOnly
- Classifies first-party vs third-party by domain matching
- Tracks persistence: session vs persistent, longest expiry in days

### Verdict
- Scores 0-100 based on weighted findings across all categories
- Risk levels: low (0-15), moderate (16-40), high (41-70), critical (71-100)
- Plain-language recommendation for each level

## Module reuse

wearehere does not reinvent detection logic. It reuses the actual scanner modules from each extension:

| File in wearehere | Source | Version |
|-------------------|--------|---------|
| `tos-scanner.js` | wearetosed `scanner.js` | v0.1.0 |
| `inject.js` prototype wrappers | wearewatched `inject.js` | v0.1.0 |
| `content.js` tracker domain list | wearecooked `content.js` | v4.0.0 |
| `content.js` dark pattern heuristics | weareplayed `content.js` | v0.1.0 |
| `content.js` storage patterns | weareleaking `content.js` | v0.2.0 |
| `content.js` tracking params | wearelinked `content.js` | v0.3.0 |

When a source extension updates, wearehere should pull the updated module.

## UI

### Popup (400px wide, dark theme)
- **Header**: site name + risk score badge (colored by level)
- **Risk bar**: gradient bar showing score 0-100
- **Summary**: one-line recommendation
- **7 sections** (each with icon, label, headline value, and detail):
  1. Cookies — count, 1st/3rd party split, longest expiry
  2. Trackers — hidden element count, beacon/pixel/iframe breakdown, domains
  3. Fingerprinting — technique count with bar chart per method
  4. Pressure — manipulation score, tactic list with evidence quotes
  5. Terms — toxicity score, flagged categories in casual language
  6. Stored on you — suspicious key count, flagged key names
  7. Links — tracking percentage, redirect wrappers
- **Footer**: links to Cookie Dashboard (wearecooked) and Network Dashboard (wearebaked)

### Badge
- Shows overall risk score (0-100)
- Color: green (low), orange (moderate), red (high/critical)

### Dashboard links
- Cookie Dashboard opens wearecooked's `report.html` (cookie analysis + cleaner)
- Network Dashboard opens wearebaked's `dashboard.html` (traffic monitoring + data brokers)
- Requires companion extensions installed

## Permissions

| Permission | Why |
|-----------|-----|
| `activeTab` | Badge updates on current tab |
| `storage` | Persist scan results |
| `cookies` | Read full cookie inventory via API |
| `<all_urls>` (host) | Content scripts on all pages, ToS page fetching |

## Project structure

```
wearehere/
├── mcp-server.js              # MCP server (agent-facing, uses barebrowse)
├── package.json
├── src/                       # MCP scanner source
│   ├── scanner.js
│   ├── init-scripts.js
│   ├── page-scripts.js
│   └── data.js
├── chrome-extension/
│   ├── manifest.json          # MV3
│   ├── tos-scanner.js         # From wearetosed v0.1.0
│   ├── inject.js              # Page-context prototype wrappers
│   ├── content.js             # DOM scanning
│   ├── background.js          # Aggregator + ToS fetch + cookies + verdict
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── firefox-extension/         # MV2 (TODO)
└── store-assets/
    ├── prd.md
    └── wearehere-chrome-v*.zip
```

## MCP server

wearehere also ships an MCP server (`mcp-server.js`) for agent-facing use. It exposes a single `scan_site(url)` tool that launches a headless browser via barebrowse, navigates to the URL, and runs the same detection logic. Returns structured JSON with the same categories and verdict. See mcp-server.js and src/ for details.

## Changelog

### v1.0.1 (current)
- inject.js runs in `MAIN` world via manifest (guaranteed before page scripts)
- ToS scanner uses wearetosed's actual `scanText()` with 54 regex patterns
- ToS fetcher tries 20+ paths + page-found links, scans both privacy and terms
- Meta refresh redirect following (Google pattern)
- Domain-level ToS caching
- Tab data persists across same-domain navigation and window switches
- Content script finds privacy/terms links on page for background fallback
