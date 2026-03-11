# Extension Ideas — "weare____" Privacy Series

All local-first, no backend, things big tech won't build.

---

## 1. wearesilent — Form & Keystroke Leak Detector

**What it does.** Detects when websites capture form input values (email, password, credit card) before you click submit. Many sites use session replay tools, Meta Pixel, or custom scripts to exfiltrate keystrokes in real-time for analytics or abandoned cart tracking. Shows: "This site sent your email to analytics.company.com before you clicked submit."

**Why no one has built it.** The only attempt (LeakInspector, KU Leuven 2022) is a dead MV2 proof-of-concept rejected from Chrome Web Store. No published extension does this. A USENIX study found 2,950 of the top 100,000 sites leak form data pre-submit.

**Research:** [Leaky Forms (USENIX 2022)](https://www.usenix.org/conference/usenixsecurity22/presentation/senol) | [LeakInspector source](https://github.com/leaky-forms/leak-inspector)

**APIs:** Content scripts (prototype wrapping on HTMLInputElement.value, addEventListener interception), webRequest (observe outgoing POST/beacon), MutationObserver, navigator.sendBeacon interception.

**Permissions:** `webRequest`, `activeTab`, `scripting`, `<all_urls>`

**POC scope:**
- Content script injected into every page that wraps `HTMLInputElement.prototype` value getter and `addEventListener` for `input`, `keyup`, `change`, `blur` events on `<input>` and `<textarea>` elements
- Log every time a script reads a form field value to the console: `[wearesilent] Script read input#email value: "user@example.com"`
- Background script listens on `webRequest.onBeforeRequest` for all outgoing POST requests and `sendBeacon` calls
- For each outgoing request, check if the request body/URL contains any recently-typed form values (raw string match + URL-encoded match)
- If a match is found, log it: `[wearesilent] LEAK DETECTED: value from input#email found in request to analytics.tracker.com`
- Display a red badge count on the extension icon showing number of leaks detected on current tab
- Popup shows a simple list: field name, value leaked, destination domain, timestamp

**What the POC proves:** That you can correlate form field reads with outbound requests in real-time. Does not need hash matching (MD5/SHA), redirect chain analysis, or session replay detection — those come later.

**Difficulty:** High

---

## 2. weareleaking — localStorage / sessionStorage Inspector

**What it does.** Scans every website you visit and shows what data is stored locally on your machine: localStorage keys/values, sessionStorage, IndexedDB databases. Flags suspicious patterns like tracking IDs (UUIDs), base64-encoded blobs, PII-shaped strings (emails), and shows total storage consumed per domain. A "data footprint" meter for your browser.

**Why no one has built it.** DevTools shows this but requires technical knowledge and per-tab manual inspection. No extension aggregates across all sites into a user-friendly dashboard.

**APIs:** Content scripts reading `window.localStorage`, `window.sessionStorage`, `indexedDB.databases()`. `storage` API for scan history.

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script injected on every page load that reads all `localStorage` keys/values and `sessionStorage` keys/values for the current origin
- Send results to background script via `runtime.sendMessage`
- Background script stores results keyed by domain in `browser.storage.local`
- Popup page shows a table: domain, number of keys, total size (bytes), list of key names
- Flag keys that look suspicious using simple regex: UUIDs (`/[0-9a-f]{8}-[0-9a-f]{4}/`), anything with "track", "id", "uid", "fbp", "ga", "analytics" in the key name, values that look like emails (`/@/`), base64 blobs (long alphanumeric strings)
- Badge shows count of flagged (suspicious) keys on current tab
- One-page dashboard listing all scanned domains sorted by number of suspicious keys

**What the POC proves:** That scanning localStorage/sessionStorage from a content script works, that there is a surprising amount of tracking data stored locally, and that simple pattern matching catches the obvious stuff.

**Difficulty:** Low

---

## 3. wearewatched — Device Surveillance Monitor (Fingerprinting + Permission Access)

> **Merged:** Absorbs wearetracked (fingerprint detection). Both use identical technique (prototype wrapping + page-level script injection + postMessage relay) targeting different APIs. One extension, two sections in the UI.

**What it does.** Monitors two forms of silent device surveillance: (1) fingerprinting — when sites probe Canvas, WebGL, AudioContext, and navigator properties to uniquely identify you, and (2) permission snooping — when sites access clipboard, geolocation, camera, notifications, and sensors. Shows both in a unified dashboard: "This site tried 4 fingerprinting methods and accessed 2 device permissions."

**Why no one has built it.** Fingerprint tools (Canvas Blocker, Chameleon) focus on blocking/spoofing, which breaks sites. Browsers show one-time permission prompts but no ongoing access log. No tool combines transparency for both into one view.

**APIs:** Content scripts with prototype wrapping via page-level script injection:
- Fingerprinting: `HTMLCanvasElement.prototype.toDataURL`, `WebGLRenderingContext.prototype.getParameter`, `AudioContext.prototype.createOscillator`, `navigator.hardwareConcurrency` (getter), `navigator.languages` (getter)
- Permissions: `navigator.clipboard.readText`/`read`, `navigator.geolocation.getCurrentPosition`/`watchPosition`, `Notification.requestPermission`, `navigator.mediaDevices.getUserMedia`, `DeviceMotionEvent`, `DeviceOrientationEvent`

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script injects page-level script (via `<script>` tag into page context) wrapping 8 APIs total (5 fingerprinting + 3 permission):
  - **Fingerprinting:** `HTMLCanvasElement.prototype.toDataURL`, `WebGLRenderingContext.prototype.getParameter`, `AudioContext.prototype.createOscillator`, `navigator.hardwareConcurrency`, `navigator.languages`
  - **Permissions:** `navigator.clipboard.readText`/`read`, `navigator.geolocation.getCurrentPosition`/`watchPosition`, `Notification.requestPermission`
- Each wrapper: calls the original, posts `window.postMessage` to content script with: API name, category (fingerprint/permission), call stack (first 3 frames), timestamp
- Content script forwards to background script
- Background script stores per domain in `browser.storage.local`
- Badge shows combined count (fingerprint methods + permission accesses) on current tab
- Popup shows two sections (see layout below)
- Dashboard tab shows all-sites history

**Popup layout:**
```
┌─ wearewatched popup ───────────────────┐
│  reddit.com                            │
│                                        │
│  FINGERPRINTING                4 methods│
│  ┌──────────────────────────────────┐  │
│  │ Canvas read         ██████  12x  │  │
│  │ WebGL params        ███      3x  │  │
│  │ AudioContext        ██       2x  │  │
│  │ navigator.languages █        1x  │  │
│  └──────────────────────────────────┘  │
│                                        │
│  PERMISSION ACCESS             2 APIs  │
│  ┌──────────────────────────────────┐  │
│  │ Clipboard read      ████     4x  │  │
│  │ Geolocation         █        1x  │  │
│  └──────────────────────────────────┘  │
│                                        │
│  Badge: 6  (4 fingerprint + 2 perm)    │
│                                        │
│  [Open Dashboard]                      │
└────────────────────────────────────────┘
```

**Dashboard layout:**
```
┌─ wearewatched dashboard ───────────────────────────────────┐
│                                                            │
│  All Sites               [Fingerprinting] [Permissions]    │
│                                                            │
│  Site            Fingerprint  Permissions  Last Visit      │
│  ─────────────────────────────────────────────────────     │
│  reddit.com      4 methods    2 APIs       2 min ago       │
│  amazon.com      6 methods    1 API        1 hr ago        │
│  facebook.com    5 methods    3 APIs       3 hrs ago       │
│  wikipedia.org   0 methods    0 APIs       5 hrs ago  ✓    │
│                                                            │
│  ▾ reddit.com — detail                                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Canvas toDataURL        × 12   scripts: gtm.js,     │  │
│  │                                 fbevents.js          │  │
│  │ Clipboard read          × 4    scripts: inline,      │  │
│  │                                 reddit-app.js        │  │
│  │ ... (expandable rows)                                │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

**What the POC proves:** That prototype wrapping catches real-world fingerprinting and permission access, that sites do both more often than users expect, and that a unified "device surveillance" view is more impactful than two separate tools.

**Difficulty:** Medium

---

## 4. wearecounted — Hidden Tracking Pixel & Beacon Visualizer

**What it does.** Identifies and counts tracking pixels, invisible iframes, and beacon API calls — the invisible infrastructure of surveillance. Makes the invisible visible. Shows an overlay: "This page contains 14 hidden tracking pixels, 3 invisible iframes, and 2 beacon API calls" with the ability to highlight them in the DOM.

**Why no one has built it.** Tracker blockers silently remove these elements so users never learn how pervasive they are. The educational/transparency angle — showing rather than blocking — has no commercial model.

**APIs:** Content scripts scanning for `<img>` elements with 1x1 dimensions or `display:none`, zero-size `<iframe>` elements, `navigator.sendBeacon()` calls (prototype interception), `<link rel="prefetch">` abuse. MutationObserver for dynamically injected pixels.

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script that runs on `document_idle` and scans the DOM for:
  - `<img>` elements where `naturalWidth <= 1` or `naturalHeight <= 1` or `display:none` or `visibility:hidden`
  - `<iframe>` elements where `width <= 1` or `height <= 1` or `display:none`
  - `<link rel="prefetch">` elements pointing to known tracker domains
- Also inject a page-level script that wraps `navigator.sendBeacon` to count beacon calls
- MutationObserver watches for new elements matching the above criteria (trackers often inject after page load)
- Content script counts totals and sends to background script
- Badge shows total hidden element count
- Popup shows breakdown: "8 tracking pixels, 2 hidden iframes, 4 beacon calls" with a list of destination domains
- Optional: clicking "Highlight" in popup sends a message to content script which outlines all hidden elements with a red border (`element.style.outline = '3px solid red'`) making them visible on the page

**What the POC proves:** That invisible tracking infrastructure exists on virtually every major website, and that making it visible is striking enough to be valuable on its own.

**Difficulty:** Low

---

## 5. weareplayed — Dark Pattern Scorecard

**What it does.** Assigns every website a manipulation score (0-100) based on dark patterns detected: countdown timers, pre-checked consent boxes, hidden unsubscribe flows, confirm-shaming language ("No thanks, I don't want to save money"), fake urgency ("Only 2 left!"), trick questions in opt-outs. Badge shows green/yellow/red per site. Results build up a personal "worst offenders" list.

**Why no one has built it.** Existing detectors (Pattern Shield, Dark Pattern Detector) use ML models that are slow and inaccurate. A lightweight heuristic approach with cumulative scoring is the missing middle ground.

**APIs:** Content scripts with DOM analysis, MutationObserver, CSS selector matching. `storage` for score history.

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script that runs on `document_idle` and checks for 5 common dark patterns using DOM/text analysis:
  1. **Countdown timers** — scan for elements with `setInterval`/`setTimeout` that contain time-like text (regex for `\d+:\d+:\d+` or "hours", "minutes", "seconds left")
  2. **Pre-checked checkboxes** — find `<input type="checkbox" checked>` inside forms, especially near text containing "newsletter", "marketing", "subscribe", "agree"
  3. **Confirm-shaming** — scan button/link text for negative-option patterns: "No thanks", "I don't want", "I'll pass on", "No, I prefer" (bundled phrase list)
  4. **Fake urgency** — scan visible text for "Only X left", "X people viewing", "Limited time", "Hurry", "Act now" (bundled phrase list)
  5. **Hidden unsubscribe** — scan for links/text containing "unsubscribe" and check if font-size < 10px or color contrast ratio < 2:1 against background
- Score each detected pattern (0-20 points each), sum for total page score (0-100)
- Send score + detected patterns to background script
- Badge shows color: green (0-30), yellow (31-60), red (61-100)
- Popup shows: site score, list of detected patterns with descriptions

**What the POC proves:** That simple heuristics catch the most common dark patterns reliably enough to be useful, without needing ML.

**Difficulty:** Medium

---

## 6. wearelinked — Redirect & Link Washing Exposer

**What it does.** Before you click any link, hover to see where it actually goes. Shows the full redirect chain — revealing when a "clean" link actually bounces through tracking redirects. Strips UTM parameters, fbclid, gclid, and other tracking decorations. Shows: "This link goes through: google.com/url → t.co → bit.ly → actual-site.com (3 tracking hops removed)."

**Why no one has built it.** ClearURLs handles parameter stripping. Link Redirect Trace is SEO-focused. No tool combines hover-preview, redirect chain visualization, and parameter cleaning into one simple UX. Google, Facebook, and Twitter all use link-washing to track outbound clicks.

**APIs:** Content scripts with `mouseover` event listeners. `webRequest` for redirect chain inspection. URL parsing (local string operations). Optional `clipboardWrite` for clean URL copy.

**Permissions:** `webRequest`, `activeTab`, `<all_urls>`

**POC scope:**
- Content script that adds a `mouseover` listener to all `<a>` elements
- On hover, parse the `href` and check if it's a known redirect wrapper:
  - `google.com/url?q=` — extract the `q` parameter
  - `l.facebook.com/l.php?u=` — extract the `u` parameter
  - `t.co/*` — flag as Twitter redirect (actual destination requires following the redirect)
  - `bit.ly/*`, `tinyurl.com/*` — flag as URL shortener
  - Any URL with `utm_source`, `utm_medium`, `fbclid`, `gclid`, `mc_eid` parameters — strip them
- Show a small tooltip near the link with: original URL, cleaned URL (parameters stripped), and flags for known redirect wrappers
- Background script uses `webRequest.onBeforeRedirect` to follow actual redirect chains when a user clicks a link, storing the full chain
- Popup shows recent click history: original link → full chain → final destination
- Badge shows count of tracking parameters stripped on current page

**What the POC proves:** That most pages contain links with tracking parameters, that redirect wrappers are ubiquitous, and that a hover tooltip showing the real destination is immediately useful.

**Difficulty:** Low-Medium

---

## 7. wearetosed — ToS Toxicity Scorecard

**What it does.** Scores every privacy policy and terms page from 0 to 100 based on red flags found in the text. No AI, no cloud lookups — regex pattern matching against page content. Navigate to any site's /privacy or /terms page and the badge lights up with a toxicity score. Detects 6 categories: data sharing/selling, tracking/profiling, indefinite retention, law enforcement access, rights/liability waivers, and unilateral control clauses.

**Why no one has built it.** ToS;DR rates policies manually and can't keep up. No extension does real-time, local scoring of the actual policy text you're reading. The "toxicity scorecard" angle — scoring rather than summarizing — is immediate and shareable.

**APIs:** Content scripts with URL pattern + title/h1 heuristics for policy page detection. 6 regex-based scanners against page text. `storage.session` for per-tab results. Badge scoring (green/orange/red).

**Permissions:** `activeTab`, `storage`

**POC scope:**
- Content script checks if the current page is a policy/terms page using URL patterns (`/privacy`, `/terms`, `/tos`, `/legal`, `/cookie-policy`) and title/h1 heuristics
- If matched, extracts main text content and runs 6 regex-based scanners:
  1. **Data sharing & selling** — "share with third parties", "sell your data", "transfer to partners", "provide to affiliates"
  2. **Tracking & profiling** — "track across websites", "build a profile", "collect browsing history", "web beacons", "automatically collect"
  3. **Data retention** — "retain indefinitely", "keep as long as necessary", "even after you delete", "no obligation to delete"
  4. **Law enforcement access** — "respond to subpoenas", "law enforcement requests", "cooperate with authorities", "national security"
  5. **Rights & liability waivers** — "binding arbitration", "class action waiver", "waive your right", "as-is", "without warranties"
  6. **Unilateral control** — "modify these terms at any time", "without prior notice", "sole discretion", "continued use constitutes acceptance"
- Each category detected adds 20 points (max 100)
- Badge color: green (0–20), orange (21–60), red (61–100)
- Popup shows toxicity score, verdict, and breakdown by category with matched phrases
- Non-policy pages show "Not a privacy policy or terms page"

**What the POC proves:** That simple regex catches the most common toxic clauses reliably, that virtually every major site scores high, and that a numeric "toxicity score" is more impactful than a wall of legal text.

**Difficulty:** Low-Medium

---

## 10. wearehere — Unified Privacy Dashboard

**What it does.** Single dashboard that aggregates data from all weare____ extensions into one view. Phase 1: hub extension that reads from other extensions via `externally_connectable` messaging — each extension stays independent, wearehere just aggregates. Phase 2: consolidate all scanners into one monolith extension with tabs and a unified dashboard.

**Why wait.** Each standalone extension is small, focused, easy to review for store approval, and easy to explain. A monolith needs `<all_urls>`, `webRequest`, `storage`, `scripting` — scary permission set for users who just want one feature. Ship all standalone first, then aggregate.

**Path:** Ship wearesilent (last standalone) → build wearehere as hub (reads from others) → if adoption is good, consolidate into monolith. Individual extensions become "lite" versions.

**Difficulty:** Medium (hub) / High (monolith)

---

## Pruned / Merged Extensions

### ~~wearetracked~~ → Merged into wearewatched (#3)

**Reason:** Identical architecture (prototype wrapping + page-level script injection + postMessage relay). Different API targets (fingerprinting vs permissions) but same technique. Now lives as the "Fingerprinting" section in wearewatched's UI.

### ~~wearesold~~ + ~~weareopen~~ → Merged into wearebaked (done, v0.5.1)

**What was done:** wearesold (data broker detector) and weareopen (third-party script audit) folded into wearebaked. 84 broker profiles in BROKER_META, ~54 new broker domains, broker popup with per-site verdict grouped by type, Data Broker dashboard section, 3P Scripts summary card. Firefox version includes ETP-aware broker detection (onBeforeRequest + onErrorOccurred).

### ~~wearecounted~~ → Folded into wearecooked (done, v3.0.0)

**What was done:** Pixel/beacon detection from wearecounted folded into wearecooked. Content script scans for 1x1 tracking pixels, invisible iframes, `<link rel="prefetch">` to tracker domains, and intercepts `navigator.sendBeacon` calls. MutationObserver catches dynamically injected elements. 170+ tracker domains classified by company and purpose, with URL pattern fallback. Popup shows per-site verdict with breakdown by purpose/company, plus "Open Cookie Dashboard" link to the existing report. Badge shows red count when trackers found, gray "0" when clean.

---

## Summary

| # | Extension | What it does | Chrome | Firefox | Repo |
|---|-----------|-------------|--------|---------|------|
| 1 | wearecooked | Cookie scanner + cleaner + pixel/beacon detector (popup + dashboard) | Live | Live | [hamr0/wearecooked](https://github.com/hamr0/wearecooked) |
| 2 | wearebaked | Network traffic dashboard + data broker detector | Live | Live | [hamr0/wearebaked](https://github.com/hamr0/wearebaked) |
| 3 | weareleaking | localStorage/sessionStorage tracking inspector | Pending | Live | [hamr0/weareleaking](https://github.com/hamr0/weareleaking) |
| 4 | ~~wearecounted~~ | ~~Hidden tracking pixels~~ → folded into wearecooked | — | — | archived |
| 5 | wearelinked | Redirect chain + tracking parameter exposer | Live | Live | [hamr0/wearelinked](https://github.com/hamr0/wearelinked) |
| 6 | wearewatched | Fingerprinting + permission access monitor | Live | Live | [hamr0/wearewatched](https://github.com/hamr0/wearewatched) |
| 7 | weareplayed | Dark pattern scorecard | Live | Live | [hamr0/weareplayed](https://github.com/hamr0/weareplayed) |
| 8 | wearetosed | ToS toxicity scorecard | Live | Live | [hamr0/wearetosed](https://github.com/hamr0/wearetosed) |
| 9 | wearesilent | Form input exfiltration detector | Live | Live | [hamr0/wearesilent](https://github.com/hamr0/wearesilent) |
| 10 | wearehere | Unified privacy dashboard | — | — | — |

### Completed merges

| Source | Target | Status |
|--------|--------|--------|
| wearesold + weareopen | wearebaked v0.5.1 | Done — 84 broker profiles, popup, ETP-aware detection |
| wearecounted | wearecooked v3.0.0 | Done — pixel/beacon popup + badge, 170+ tracker domains |

## Priority Order — Next Up

| # | Extension | Difficulty | Viral Potential | Build Order |
|---|-----------|-----------|----------------|-------------|
| 6 | ~~wearewatched~~ | ~~Medium~~ | ~~High~~ | **Done** — Chrome + Firefox, pending store review |
| 7 | ~~weareplayed~~ | ~~Medium~~ | ~~Medium~~ | **Done** — Chrome + Firefox, pending store review |
| 8 | ~~wearetosed~~ | ~~Low-Medium~~ | ~~Medium~~ | **Done** — Chrome + Firefox, pending store review |
| 9 | ~~wearesilent~~ | ~~High~~ | ~~Very High~~ | **Done** — Chrome + Firefox, pending store review |
| 10 | wearehere | Medium-High | High | After all standalone extensions ship |

##TODO List
cancel wearecounted from chrome
resubmit new fixed chrome package wearetosed
---

## Future Directions

### Future #1 — Leave the Suite As-Is

The extensions are shipped, they work, they have educational value. Maintain but don't over-invest. The suite is a completed body of work documenting how the 2020s web manipulates users. That has archival and research value regardless of what happens next.

### Future #2 — MCP Layer: `weare-mcp`

Package all detection engines as a single MCP (Model Context Protocol) server that any AI agent, browser, or tool can call. The unified view becomes MCP output, not another extension. Skip wearehere (the monolith dashboard) — this replaces it.

**What it exposes:**

One MCP server with tools:

| Tool | Source Extension | What It Returns |
|------|-----------------|-----------------|
| `scan_cookies` | wearecooked | Cookie inventory, classification (necessary/analytics/advertising), third-party count, tracker pixel/beacon count |
| `scan_fingerprinting` | wearewatched | Fingerprinting methods detected (Canvas, WebGL, AudioContext, navigator probes), call counts, source scripts |
| `scan_permissions` | wearewatched | Permission access attempts (clipboard, geolocation, camera, notifications), source scripts |
| `scan_dark_patterns` | weareplayed | Dark pattern score (0-100), detected patterns (countdown timers, confirm-shaming, fake urgency, pre-checked boxes, hidden unsubscribe) |
| `scan_tos` | wearetosed | ToS toxicity score (0-100), flagged categories (data selling, tracking, retention, law enforcement, liability waivers, unilateral changes), matched phrases |
| `scan_trackers` | wearecooked | Hidden tracking pixels, invisible iframes, beacon calls, prefetch abuse, tracker domain classification by company/purpose |
| `scan_storage` | weareleaking | localStorage/sessionStorage keys per domain, flagged suspicious keys (UUIDs, tracking IDs, PII-shaped values), total storage consumed |
| `scan_redirects` | wearelinked | Redirect chain for a URL, tracking parameters found (utm_*, fbclid, gclid), cleaned URL, number of tracking hops |
| `scan_form_leaks` | wearesilent | Form fields being read pre-submit, destinations receiving leaked values, leak count |
| `scan_all` | all | Runs all scanners, returns unified site audit with overall privacy score |

**Example agent interaction:**

```
Agent: "User wants to buy from sketchy-store.com. Let me audit it first."

→ scan_all("sketchy-store.com")

← {
    "dark_patterns": { "score": 75, "patterns": ["countdown_timer", "fake_urgency", "confirm_shaming"] },
    "tos_toxicity": { "score": 80, "categories": ["data_selling", "no_deletion", "binding_arbitration"] },
    "fingerprinting": { "methods": 6, "details": ["canvas", "webgl", "audio", "navigator.*"] },
    "trackers": { "pixels": 14, "beacons": 3, "iframes": 2 },
    "form_leaks": { "pre_submit_exfil": true, "destinations": ["analytics.tracker.com"] },
    "verdict": "high_risk"
  }

Agent: "This site scores high-risk. It uses dark patterns to pressure you, its ToS allows selling your data, and it leaks form input before you submit. Want me to find alternatives?"
```

**How it works technically:**

The MCP server is a standalone Node.js process. It does NOT run browser extensions — it re-implements the detection logic from each extension as pure JS/TS functions that operate on fetched HTML, parsed DOM (via jsdom/linkedom), and HTTP response headers. The extension heuristics (regex lists, tracker domain lists, dark pattern phrase lists, ToS toxicity patterns) port directly since they're already plain JS.

For scans that require runtime behavior (fingerprinting detection, form leak interception, beacon calls), the MCP server can either:
- **Static analysis mode:** Parse scripts for known fingerprinting API calls, tracker patterns, dark pattern DOM structures. Covers 80% of cases.
- **Browser mode (optional):** Launch a headless browser (Playwright) to load the page and run the detection scripts in a real browser context. Full accuracy, slower.

**Publishing — npm, not curl:**

- MCP servers need a persistent process — `npx` / `npm install -g` is the standard pattern that Claude Desktop, Cursor, VS Code, and every MCP client already supports
- Publish as `@hamr0/weare-mcp` on npm
- Users install with: `npx @hamr0/weare-mcp` or add to their MCP config
- curl is for one-shot scripts — MCP servers are long-running processes, npm is the right fit

**Separate from BareBrowse, consumable by BareBrowse:**

Keep `weare-mcp` as its own package and repo. Reasons:
- **Different release cycles.** Detection heuristics (tracker domains, dark pattern phrases, ToS patterns) update frequently. BareBrowse has its own release cadence.
- **Different audiences.** Anyone with an MCP client can use weare-mcp — not just BareBrowse users. Claude Desktop, Cursor, Cline, custom agents, other AI browsers.
- **BareBrowse consumes it as a dependency.** BareBrowse can list weare-mcp as a built-in MCP server in its config, so every BareBrowse user gets privacy scanning out of the box. But the scanning logic lives in its own package.
- **Avoids permission bloat.** BareBrowse stays a browser. weare-mcp stays a scanner. Clean separation of concerns.

```
# In BareBrowse's MCP config:
{
  "mcpServers": {
    "weare-privacy": {
      "command": "npx",
      "args": ["@hamr0/weare-mcp"]
    }
  }
}
```

**What this enables downstream:**

- Any agent can audit a site before the user (or agent) interacts with it
- Personal privacy profiles: "my agent knows which sites are safe and which aren't"
- Comparative shopping: "scan these 5 stores, rank by privacy score"
- Agent guardrailing: the profiling data that used to be snooped on users can instead be owned by the user's agent — your agent knows YOU, not their tracker
- The detection heuristics survive the shift from user experience to agent experience because they're now tools agents call, not UI humans click

**Why now:**

The whole internet is shifting from user experience to agent experience. Most browsing gimmicks will shift too, but:
- **Profiling stays.** Sites will profile agents the same way they profile users — to manage guardrailing agents toward certain prices and options the user is most likely to purchase
- **Dark patterns evolve.** Fake urgency, confirm-shaming, and manipulation will target agent-readable content (structured data, API responses, schema.org markup) not just DOM
- **ToS toxicity stays.** Legal terms don't change because the reader is an agent
- **Tracking infrastructure stays.** Server-side tracking is growing, but client-side pixels and beacons aren't going away soon
- **This might be the last window** where these gimmicks are fully visible client-side. As tracking moves server-side (Meta Conversions API, server-side GTM), client-side detection becomes less effective — not because surveillance stops, but because it moves where scanners can't see it. Capturing the detection logic now, in a reusable format, preserves it

**Build order:**

1. Extract heuristics from all extensions into a shared `weare-core` library (tracker domains, dark pattern phrases, ToS patterns, fingerprint API signatures)
2. Build MCP server wrapping `weare-core` with static analysis mode (jsdom/linkedom)
3. Add optional Playwright browser mode for full-accuracy scans
4. Publish to npm as `@hamr0/weare-mcp`
5. Wire into BareBrowse as a built-in MCP server
6. Write up findings — blog posts / report on "what we found scanning thousands of sites"

**Difficulty:** Medium-High

---

## Sources

- [Leaky Forms (USENIX Security 2022)](https://www.usenix.org/conference/usenixsecurity22/presentation/senol)
- [LeakInspector source code](https://github.com/leaky-forms/leak-inspector)
- [Princeton Web Transparency Project (2017)](https://privacyinternational.org/examples/1918/no-boundaries-exfiltration-personal-data-session-replay-scripts)
- [NYU: Privacy Extensions Fail User Needs](https://engineering.nyu.edu/news/privacy-enhancing-browser-extensions-fail-meet-user-needs-new-study-finds)
- [EFF on Manifest V3 Privacy Implications](https://www.eff.org/deeplinks/2021/12/googles-manifest-v3-still-hurts-privacy-security-innovation)
- [OWASP Browser Extension Vulnerabilities](https://cheatsheetseries.owasp.org/cheatsheets/Browser_Extension_Vulnerabilities_Cheat_Sheet.html)
