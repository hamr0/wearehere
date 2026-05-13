# wearehere — rebuild plan

> Companion to [PRD.md](./PRD.md). The PRD defines *what* the new design is; this file defines *how* and *in what order* we build it. Chrome first, Firefox mirror last.
>
> **Mandatory rules:** all implementation work follows `.claude/memory/AGENT_RULES.md` — POC first, incremental modules, vanilla→stdlib→external dependency hierarchy, surgical changes, open-source only, mobile-responsive UI verified in DevTools before claiming UI tasks done.

## Scope

Collapse 6 dashboard tabs → 3 (Overview · Watchers · Cookie scoper), rewrite popup from 8 cards → 3 blocks + scoper card, drop the 4 redundant tabs. New design needs cross-session persistence (today there's none — `tabData[tabId]` is in-memory-only).

## Architecture decision — Cookie scoper lives in wearehere

Cookie scoper ships **inside wearehere**, not as a separate wearecooked extension. Reasons:

- One install, not two — non-tech users get the whole experience from one Chrome Web Store listing.
- No cross-extension permission dance — no `externally_connectable`, no extension-ID handshake, no `{error: "unauthorized"}` degrade path.
- All storage in one `chrome.storage.local` — sweep state, trust list, visit history live next to each other; "What changed" event log can natively include sweep events without crossing an extension boundary.

The `port-kit/` branch of `hamr0/wearecooked` (phase 1, 23 commits, harness 21/21) provides **starting-point code** to transplant — not a cross-extension bridge. We port it into wearehere as internal modules.

## Scaffold — port-kit code as internal modules

```
port-kit/ (from hamr0/wearecooked branch phase1-cookie-scoper)
├── INTEGRATION-GUIDE.md          recipe (151 lines) — read first, then adapt for internal use
├── scoper-bridge.js              cross-extension data layer (68 lines)
├── popup-card/                   Cookie scoper card markup + CSS + JS (351 lines total)
└── dashboard-blocks/             four blocks for #panel-cookies (651 lines total)
```

**Transplant approach (not drop-in):**

| Port-kit file | Lands as | Adjustment |
|---|---|---|
| `scoper-bridge.js` | `chrome-extension/scoper/storage.js` | Rewire: replace `chrome.runtime.sendMessage` cross-ext calls with direct `chrome.storage.local` reads/writes |
| `popup-card/popup-card.html` | inline into `chrome-extension/popup.html` | Drop the `.scoper-card` scope wrapper only if styles can be safely merged; otherwise keep as scoped block |
| `popup-card/popup-card.css` | merge into `chrome-extension/popup.css` (or keep as scoped `scoper-card.css`) | Verify no class collisions with existing popup |
| `popup-card/popup-card.js` | `chrome-extension/scoper/popup-card.js` | Replace bridge calls with internal storage calls; keep render logic intact |
| `dashboard-blocks/*` | mirror to `chrome-extension/scoper/dashboard-*.{html,css,js}` | Same: replace bridge calls; keep block layout + actions intact |

The sweep logic itself (alarm handler, cookie rewrite, counter increments) lives in `chrome-extension/background.js` as a new section — not a separate service worker, since wearehere already has one.

**What we keep from the port-kit:**

- Locked four-block dashboard layout (already PRD-aligned)
- Locked popup-card markup (already PRD-aligned)
- Scoped CSS class names (`.scoper-card`, `.scoper-dashboard`)
- Add / remove / toggle / settings interactions

**What we drop:**

- `externally_connectable` manifest config
- `WEARECOOKED_ALLOWED_EXT_IDS` allowlist
- Cross-extension `sendMessage` boilerplate in `scoper-bridge.js`
- Two-side handshake step

## POC discipline — already-validated vs. needs-validation

**Cookie scoper sweep cycle is already validated** in the `hamr0/wearecooked` port-kit branch (23 commits, harness 21/21). No POC needed — Phase 2 is a port + rewire, not a discovery.

**POCs ARE required** for everything else that's unproven:

| Mechanism | Phase | POC question |
|---|---|---|
| `chrome.storage.local` schema migration on existing installs | 1 | Does v3.2.0 → new-schema upgrade preserve `tabData`-derived signals on first run? |
| Window-snapshot diff logic | 5 | Can we cheaply diff `week.current` vs `week.prior` in <100ms with 1000 visits stored? |
| Score history rendering with vanilla SVG | 5 | Does the line chart scale legibly from popup-narrow to dashboard-wide widths? |
| Mechanism deduplication across tabs | 3 | Does emitting a canonical chip set from `tabData` actually produce stable popup output on dynamic sites? |

Per AGENT_RULES: each POC is ~15 min, hardcoded values OK, no tests. Graduates when the unknown is answered → stop, design properly, rewrite. Never ship the POC.

## Build phases — Chrome first

### Phase 1 — Foundations (storage + permissions)

| Step | File | Action |
|---|---|---|
| 1.1 | `chrome-extension/manifest.json` | Add `"storage"`, `"alarms"`, `"cookies"` permissions |
| 1.2 | `chrome-extension/background.js` | Define versioned `chrome.storage.local` schema: `visitHistory`, `windowSnapshots`, `scoreHistory`, plus scoper keys: `cookieScopeCounters`, `trustList`, `cookieScopeSweepLog`, `cookieScopeSettings` |
| 1.3 | `chrome-extension/background.js` | On each completed navigation, append a visit record `{domain, timestamp, score, trackers, termsScore}` |
| 1.4 | `chrome-extension/background.js` | Periodic recompute (on `chrome.alarms` tick) of `windowSnapshots.week/month/allTime` from `visitHistory` |
| 1.5 | `chrome-extension/background.js` | Daily score samples appended to `scoreHistory` |

**Success criteria:** browse 5 sites; reload extension; `chrome.storage.local.get(null)` shows all 5 visits with attribution intact.

**Storage budget:** `chrome.storage.local` is unlimited for installed extensions, but keep records lean — strip URLs to domains, dedupe trackers per visit, cap `visitHistory` at last 1000 visits.

### Phase 2 — Cookie scoper module (transplanted from port-kit)

Internal module. Sweep logic and storage are wearehere-native.

| Step | File | Action |
|---|---|---|
| 2.1 | `chrome-extension/scoper/storage.js` (new) | Internal helpers: `getTrustList()`, `setTrust()`, `removeTrust()`, `getCounters()`, `incrementCounter()`, `appendSweepLog()`, `getSettings()`, `setSweepPeriod()` — thin wrappers over `chrome.storage.local` |
| 2.2 | `chrome-extension/background.js` | Sweep handler: on `chrome.alarms` tick (period from `cookieScopeSettings.sweepPeriod`), iterate `chrome.cookies.getAll`, apply cap rules (1p → 7d, 3p on trusted-only path on tab close, etc.), update counters and log |
| 2.3 | `chrome-extension/background.js` | Tab-close listener: kill 3p cookies for sites not in trust list |
| 2.4 | `chrome-extension/scoper/popup-card.{html,css,js}` (from port-kit) | Transplant; rewire JS calls from `chrome.runtime.sendMessage` to local `storage.js` |
| 2.5 | `chrome-extension/scoper/dashboard-blocks.{html,css,js}` (from port-kit) | Transplant; same rewiring |

**Success criteria:** sweep alarm fires on the configured cadence; trust list survives restart; popup card and dashboard blocks render real counters and trust-list state.

**Responsive check:** popup card must render correctly at 360px width (mobile breakpoint). Dashboard blocks must stack vertically below ~700px viewport — no horizontal scroll. Verify in Chrome DevTools device emulation before claiming Phase 2 done.

### Phase 3 — Popup rewrite (non-scoper blocks)

Replace 8-card legacy layout with 3 blocks; scoper card from Phase 2 docks at the bottom.

| Step | File | Action |
|---|---|---|
| 3.1 | `chrome-extension/popup.html` | Restructure: Header + Who's watching + Footer chip row + (existing) Scoper card |
| 3.2 | `chrome-extension/popup.js` | Mechanism deduplication: emit canonical chip set per company from `tabData` (cookies / pixels / device ID / typing / clicks) |
| 3.3 | `chrome-extension/popup.js` | Company ranking by mechanism-count for "Who's watching" (top 2 + `+N more` rule) |
| 3.4 | `chrome-extension/popup.js` | Footer chip row: render only chips with status; collapse to `✓ All clear` when all green |
| 3.5 | `chrome-extension/popup.js` | Delete legacy card builders (Network, Stored data, Forms, Profiling, Selling, Pressure, Clicks) |
| 3.6 | `chrome-extension/popup.css` | Trim styles for removed cards |

**Success criteria:** popup renders 3 blocks + scoper card on any site. Mechanism chips identical to dashboard vocabulary.

**Responsive check:** popup is already fixed-width (typical extension popup) but verify text doesn't wrap awkwardly at the smallest configurable width.

### Phase 4 — Watchers tab (renamed from Tracking)

Cross-session aggregation from `visitHistory`.

| Step | File | Action |
|---|---|---|
| 4.1 | `chrome-extension/report.html` | Rename tab button `Tracking` → `Watchers`; rename panel ID |
| 4.2 | `chrome-extension/report.js` | Hero strip (sites visited / hidden contacts / unique watchers / amplification ratio) + window selector |
| 4.3 | `chrome-extension/report.js` | "Who follows you" block — aggregate `visitHistory` by company, rank by reach % within selected window |
| 4.4 | `chrome-extension/report.js` | "Recent visits" table — Site / Tag-alongs / Top watchers / Terms column |
| 4.5 | `chrome-extension/report.js` | Terms block w/ site selector; defaults to most-exposed; Recent-visits row click re-points selector |
| 4.6 | `chrome-extension/report.html`/`report.js` | Delete `Network`, `Terms`, `Network Map` tab buttons + panels |

**Success criteria:** Watchers tab shows company reach across all sites in selected window. Recent-visits row click jumps Terms block to that site.

**Responsive check:** tables must collapse to stacked rows on narrow viewports — no horizontal scroll. Window selector remains tappable.

### Phase 5 — Overview tab (time-based story)

Diffs from `windowSnapshots`, chart from `scoreHistory`.

| Step | File | Action |
|---|---|---|
| 5.1 | `chrome-extension/report.js` | Replace Overview cards with hero strip (sites visited / avg score delta / new watchers / most-exposed) + window selector |
| 5.2 | `chrome-extension/report.js` | "What changed" event log — diff `windowSnapshots.current` vs `windowSnapshots.prior`; typed events with `↗ ↘ ✓ ⊕` icons; rank by magnitude × visit-frequency; cap visible at 8 with `Show all (N)` expander |
| 5.3 | `chrome-extension/report.js` | Score trend chart — small SVG line plot from `scoreHistory` (vanilla SVG, no charting library) |

**Success criteria:** after a week of browsing, Overview shows real deltas. Score trend SVG renders correctly across viewport widths.

**Responsive check:** SVG chart must scale to container width; events list stacks naturally.

### Phase 6 — Cleanup pass

Confirm dropped surfaces are gone; verify no dead code paths.

- Delete unused CSS, unused images, unused module attribution paths for removed tabs (`network`, `terms` standalone, `graph`).
- Audit `manifest.json` permissions — drop anything no longer used.
- Fresh-profile smoke test — storage migrations don't break on first install.

### Phase 7 — Firefox mirror

After Chrome is stable.

| Step | Action |
|---|---|
| 7.1 | Mirror all `chrome-extension/` changes to `firefox-extension/` |
| 7.2 | Manifest dialect adjustments for Firefox MV3 |
| 7.3 | Verify `chrome.alarms` + `chrome.cookies` parity in Firefox |
| 7.4 | Smoke test on FF stable + FF Nightly |

## Dependency graph

```
POC (storage + sweep cycle validation)
   │
   ▼
Phase 1 (foundations: permissions + storage schema + visit history capture)
   │
   ├─► Phase 2 (Cookie scoper module — depends on Phase 1 storage)
   │      │
   │      └─► Phase 3 (popup — scoper card slots into bottom)
   │
   ├─► Phase 4 (Watchers — depends on Phase 1 visit history)
   │
   └─► Phase 5 (Overview — depends on Phase 1 snapshots + score history)

Phase 6 (cleanup) — last in Chrome track
Phase 7 (Firefox mirror) — only after Chrome ships
```

Phases 3, 4, 5 can run in parallel once Phase 2 lands (popup needs scoper card position; Watchers and Overview need storage).

## AGENT_RULES alignment checklist

Every phase must respect:

- **POC first** — for any unproven mechanism (sweep cycle, snapshot diff, chart rendering), prototype the logic in <50 lines before structuring it
- **Vanilla → stdlib → external** — no charting library; use SVG. No state-management library; use plain modules. No CSS framework; extend existing styles
- **Surgical changes** — touch only what the phase requires. Don't refactor unrelated code. Don't rename adjacent identifiers
- **Responsive UI** — every UI phase ends with a DevTools device-emulation check before marking done
- **Open-source only** — all dependencies in this rebuild are stdlib browser APIs (`chrome.storage`, `chrome.alarms`, `chrome.cookies`, DOM, SVG). No new packages
- **Every line has a purpose** — no speculative code. If a `windowSnapshots.allTime` field isn't surfaced anywhere yet, don't compute it
- **Identify affected files before changes** — each phase lists files explicitly above; updates require updating the table

## Open items / decisions deferred

- **Score trend storage granularity** — per-visit vs. per-day-per-site. POC will tell us; default to per-day-per-site for cheapness.
- **Visit history retention** — last 1000 visits proposed. Confirm sufficient for "all time" window or set explicit time cap (e.g., 90 days).
- **Mechanism vocabulary edge cases** — `typing` definition when input listeners are passive vs. active. Document alongside the cooked module.
- **Empty-state copy** — fresh-install Overview / Watchers placeholders ("Visit a few sites to populate this view"). Wording TBD.
- **Tab order in `report.html`** — new order: Overview / Watchers / Cookie scoper. Confirm before Phase 4 starts.
- **Port-kit `scoper-bridge.js`** — final shape after rewiring may be small enough to inline into `popup-card.js`. Decide during Phase 2.

## Test plan

Per-phase smoke checks above. Cross-phase integration test (run after Phase 5):

1. Fresh install in clean Chrome profile.
2. Visit 10 mixed sites (news / shopping / social / dev) over 3 sessions, closing the browser between.
3. Verify each tab populates: popup live, Watchers cumulative, Overview deltas, Cookie scoper trust + counters working.
4. Trust a site (popup `Trust 30d`), confirm next sweep doesn't trim it (scoper tab Trusted sites row appears).
5. Remove trust, confirm next sweep re-caps.
6. Force-quit and reopen browser; verify storage survives.
7. DevTools device emulation at 360px and 768px — all surfaces usable, no horizontal scroll.
8. Mirror smoke test on Firefox in Phase 7.

Per AGENT_RULES testing standards: write tests **after design stabilizes**, not during exploration. Phases 1, 2 are exploratory (POC-graduated); add regression tests once behavior is locked. Phases 3–5 are UI integration — assert behavior end-to-end, not implementation details.

## What's not in this plan

- Score formula changes (out of scope; mechanism vocab change should not move scores)
- New detector functions (Phase 0 added 0 detectors; this rebuild adds 0 too)
- npm package surface changes (`wearehere` package consumes `assess` shape; unchanged)
- Marketing / store assets (separate PRD section, post-ship)
- wearecooked phase 1 ship (decided: not shipping; scoper lives here)
