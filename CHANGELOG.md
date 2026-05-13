# Changelog

All notable changes to wearehere are recorded here. Versions follow the `chrome-extension/manifest.json` line; root + `firefox-extension/` track the same number.

## [4.0.0] — 2026-05-13

First active-intervention release. v3.x detected; v4.0.0 detects **and acts back** — the Cookie scoper rewrites tracker-cookie expirations and kills third-party cookies on tab close. Full popup + dashboard rewrite, cross-session visit history, and Tokyo Night dark theme. The v3.x line is archived at `origin/v1`.

### Highlights

- **Cookie scoper** — internal module that runs on a tunable alarm (15min / 1hr / 4hr / 12hr). Caps first-party cookies at 7 days, demotes name-matched trackers, deletes third-party cookies when their owning tab closes. Manual `[ Sweep now ]` button + per-site `[ Trust 30d ]` / `[ Trust 90d ]` overrides.
- **Cross-session visit history** — every tab close + same-tab domain change snapshots a compact visit record into a 1000-entry ring buffer in `chrome.storage.local`. Lets the dashboard answer "what changed this week?" instead of "what's on this page right now?"
- **Window-snapshot storage** — Overview + Watchers aggregates precomputed per time window (today/week/month) on a 60-min alarm + post-append staleness check. Reads drop from O(1000 records) to O(~50 aggregates) per dashboard render.
- **Per-watcher mechanism attribution** — cookies, pixels, clicks, and device-id are now attributed to the company doing them, not just the page. Device-id resolution via `inject.js` stack-walk → caller host → cooked-items company map. Typing remains site-level by design (form-field exposure isn't observable per-script).
- **Popup rewrite** — 8 cards → 3 blocks + footer chips + scoper card. Mechanism vocabulary locked: `cookies · pixels · device-id · typing · clicks`.
- **Dashboard rewrite** — 6 tabs → 3 tabs (Overview / Watchers / Cookie scoper). Cookies / Network / Terms / Network Map all folded or retired.
- **Brand identity** — `[we]arehere` lockup. Filled-rectangle bracket marks for symmetric pixel coverage at every size; pixel-aligned 16px icon. Logo variant D won live-canvas voting.
- **Tokyo Night** dark palette replaces the pure-black amber theme. Light theme unchanged. Brand mark stays warm amber on both.

### Added

- `chrome-extension/scoper/scoper.js` — sweep module: alarm registration, 1p anchor + cron-gate, classifier-driven tracker demotion, sweep history, telemetry counters.
- `chrome-extension/visits.js` — compact visit-record schema, ring-buffered append, scoper-tightened snapshotted at visit time.
- `chrome-extension/snapshots.js` — rolled-up aggregates per window with `aggregateWindow()` + `recomputeIfStale()` + `getWindowAggregates()`.
- `chrome-extension/inject.js` — stack-walk in fingerprint + permission wrappers so detect-watched can bucket reads per caller host.
- `chrome-extension/detect-linked.js` — `provider` field per tracked link (TRACKING_PROVIDERS / REDIRECT_WRAPPERS).
- Dashboard: window selectors (today / week / month / all), score-trend with tier bands + per-visit dots, clear-history button, dashboard refresh resilient to SW restart.
- Popup: scoper card with state matrix (untouched / swept / clean / trusted), binary theme toggle, mechanism chips, watcher-count rules (0/1/2/3+).
- `chrome-extension/icons/logo.svg`, `wordmark.svg` — `[we]` master art (brackets as filled rects).
- New manifest permissions: `alarms`, `storage`.

### Changed

- `manifest.json` — version bumped 3.2.0 → 4.0.0; description rewritten toward detection + intervention posture; added `alarms` + `storage`.
- `background.js` — scoper:* and visits:* message handlers; visit lifecycle (snapshot + evict on tab close + domain change); broader tab dropdown (all http(s) tabs with watcher-count or `(no scan)` label); per-company click + device-id rollup folded into `trackerCompanies` before final `companies` sort.
- `report.js` — Overview + Watchers consume `windowSnapshots` aggregates; `loadOverview` / `loadCrossSiteWatchers` split into snapshot-driven + raw-history-driven loaders; storage watcher re-renders only the blocks whose source key changed.
- `popup.{html,css,js}` — 3-block layout + brand lockup + scoper card live; new color tokens for Tokyo Night.
- `report.{html,css,js}` — Overview / Watchers / Cookie-scoper tabs only; brand lockup; theme button; mechanism words column; what-changed event log; cookies-in-your-browser coverage block.
- `icon{16,48,128}.png` — re-rendered from filled-rectangle bracket art; 16px hand-tuned for pixel-aligned brackets.

### Fixed

- **Late-arriving tab messages** — `chrome.action.setBadgeText` previously rejected with `No tab with id: …` when a content-script message arrived for a tab Chrome had already torn down. `ensureTab` now drops messages for known-removed ids; badge updates are also wrapped in `.catch`.
- **bgFetch SSRF gate** — `bgFetch` accepted arbitrary URLs from content-script messages; now rejects non-http(s), localhost, `.local` / `.internal`, IPv4 private ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, 0/8, multicast, CGNAT), all IPv6 literals, and oversize URLs. Applied to both the entry URL and meta-refresh redirects.
- **Verbose detect-tosed logs** gated behind `DEBUG = false` — 8 per-page diagnostics no longer noise the service-worker console on every navigation.
- **16px icon stretched horizontally** — was being written 16×12 due to a non-square per-size SVG viewBox, then stretched by Chrome's toolbar slot. Re-rendered from a pixel-aligned 16×16 SVG.

### Removed

- `chrome-extension/graph.js` (1309 lines) — Network Map force-directed graph view, retired with the Network Map tab.
- 8 retired-tab icons: `baked.png`, `cooked.png`, `played.png`, `linked.png`, `silent.png`, `tosed.png`, `watched.png`, `leaking.png` — none of these tabs ship in v4.x.

### Deferred (logged in PRD.md)

- Footer-chip expand-on-click for ⚠ chips.
- What-changed `[ Show all (N) ]` expander + ranking by magnitude × visit-frequency.
- Score-trend prior-window comparison footer.
- Cookie-scoper "Inspect all N cookies" expander.
- **Phase 7 Firefox mirror** — `firefox-extension/` is currently labeled v4.0.0 but still on the v3.x feature set (MV2, no scoper, no visit history). Blocking gap for AMO re-submission.

### Notes

- Branch protection on `origin/main` requires PRs but admin bypass was used for the v4.0.0 push. Decide whether to tighten or keep the owner-bypass workflow.
- The `wearehere` npm package's v4.0.0 (commit `0f73435`) shares a version number with the extension by coincidence — extension version space is tracked independently in the manifest. Stores list the extension version separately.

[4.0.0]: https://github.com/hamr0/wearehere/commits/main
