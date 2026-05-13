# wearehere — Phase 0 PRD

> Status: in progress. wearehere v3.2.0 ships a 10-category privacy scanner. Phase 0 extends the **Cookies** category with curated tracker-name classification borrowed from the Open Cookie Database, plus a fingerprint-surface enumeration borrowed from JShelter. Detection only — no intervention, no behavior change. This PRD covers Phase 0 in isolation; Phase 1+ (cookie scoping, fingerprint farbling) live in [wearecooked v5's PRD](https://github.com/hamr0/wearecooked/blob/main/PRD.md).
>
> **Source correction (2026-05-12).** Original draft named *Cookie AutoDelete* as the cookie-pattern source; investigation showed CAD bundles no curated list — it's a user-defined-expressions framework. Switched to the **Open Cookie Database** (jkwakman/Open-Cookie-Database, Apache-2.0, 2,264 cookies / 354 vendors / 6 categories). Same shape, better data, license-compatible. Phase 0 data files now landed: see `chrome-extension/cookie-database.js` and `chrome-extension/fingerprint-surfaces.js`.

## Why Phase 0 in wearehere

wearehere is the aggregator — it observes, scores, reports. Today its cookie classification uses (1) third-party domain heuristic and (2) the network-domains.js tracker list. It does *not* classify cookies by their **name**, which is where the richest tracker signal lives (`_ga`, `_fbp`, `IDE`, `MUID`, `__utma`, …).

Phase 0 closes that gap by lifting the **Open Cookie Database** — a hand-curated 2,264-entry classification of well-known cookies by name, vendor, and purpose, maintained as the de-facto seed dataset for cookie consent tools (Cookiebot, Klaro, and friends derive from it). The data file is consumed by wearehere's existing cookie classifier; pure detection upgrade, matches wearehere's mission.

The same data file is the dependency for [wearecooked v5 phase 1](https://github.com/hamr0/wearecooked/blob/main/PRD.md) (cookie scoper), so this phase unblocks two repos with one extraction.

In parallel, the JShelter fingerprint-surface enumeration ships as `fingerprint-surfaces.js` — 149 Web API surfaces categorized by fingerprint signal (canvas / webgl / audio / navigator / screen / fonts / timing / sensors / storage / locale / permissions / inspector). Today's `inject.js` wraps ~6 of these for detection; the surface list documents the larger universe for future expansion without committing to wrap all of them now.

## What we borrow, exactly

| Source | Files | What we extract | License posture |
|---|---|---|---|
| **Open Cookie Database** ([github.com/jkwakman/Open-Cookie-Database](https://github.com/jkwakman/Open-Cookie-Database)) | `open-cookie-database.json` | 1,989 exact-match cookie names + 260 prefix-match patterns × {Analytics, Marketing, Functional, Necessary, Security, Personalization} across 354 vendors | Apache-2.0. License-compatible with wearehere (also Apache-2.0). Lifted as factual data with NOTICE attribution. Snapshot SHA pinned. |
| **JShelter web-extension** ([github.com/patrik-dekys/JShelter-webextension](https://github.com/patrik-dekys/JShelter-webextension)) | `common/fp_config/wrappers-lvl_0_1.json` | 149 Web API surfaces (74 properties + 75 functions) categorized into 12 fingerprint groups | GPL-3.0 source. Enumeration of API surfaces is factual data; lifted with NOTICE attribution. No JShelter source code reused. wearehere stays Apache-2.0; the wrapper implementations in `inject.js` are original. |

**Scope discipline:** lists only. No code, no UX patterns. The lifecycle UX ("delete N seconds after tab close") belongs to wearecooked v5, not here.

## What this gets wearehere

The existing **Cookies** card and **Cookies** dashboard tab gain:

1. **Per-cookie category label.** Today: "12 cookies, 4 third-party, longest 365 days." After Phase 0: each cookie row in the dashboard table also shows `analytics` / `advertising` / `social` / `session` / `unknown` based on name match, alongside the existing third-party/duration signals.
2. **Better top-line summary.** Popup card: "8 ad-tech, 3 analytics, 1 session" instead of (or alongside) raw third-party count.
3. **Sharper "Clean Cookies" CTA.** The cleaner currently classifies "risky" via report.js heuristics. Phase 0 lets it offer category-targeted clean ("Clean ad-tech only").
4. **Score input refinement.** The Cookies score weight stays at 15, but the calculation can use category counts (e.g., +5 for ≥3 ad-tech cookies) rather than just longestDays / thirdParty thresholds. Optional for Phase 0 — start by only surfacing labels; revisit scoring after a week of real data.

No new tab. No new score category. The 9 detector functions and 7 dashboard tabs are unchanged in count and arrangement.

## Where it lands in the code

| File | Change | Estimated lines |
|---|---|---|
| `chrome-extension/cookie-patterns.js` *(new)* | Data file: pattern → category map; allowlist of essential cookies by domain | ~250 lines of data, generated from upstream |
| `chrome-extension/background.js` | In `fetchCookies()` (currently line ~554), classify each cookie by name lookup; aggregate counts per category into `tabData[tabId].cookies` | ~30 lines |
| `chrome-extension/popup.js` | `cookiesSection()` (currently line ~89) — show category breakdown when categories are non-empty | ~10 lines |
| `chrome-extension/report.js` | Cookies tab — add category column to the table; add category-targeted clean buttons | ~40 lines |
| `chrome-extension/manifest.json` | No change (no new permissions) | 0 |
| `NOTICE` *(new or extended)* | Attribution for the borrowed list | ~10 lines |

Mirror to `firefox-extension/` is identical. Same data file shipped twice (or referenced via build symlink — current repo convention is duplication; preserve it).

## What we can do (Phase 0 capabilities)

- **Static name-match classification.** Exact match + simple prefix/suffix patterns (e.g., `_ga*`, `__utm*`). No regex engine needed for the v1 list.
- **Bundled list, no network fetch.** Updates ship with the extension version. List staleness is acceptable — tracker cookie names change slowly (years between major shifts).
- **Zero new permissions.** `cookies` is already granted.
- **No behavior change.** wearehere stays observational. Existing scoring inputs preserve until the Cookies tab redesign explicitly opts into category-based scoring.
- **Reusable artifact.** The same `cookie-patterns.js` is the input file wearecooked v5 reads from. Either repo can host the canonical copy; recommendation is wearehere hosts (it's the upstream-facing scanner), wearecooked vendors a snapshot pinned to a wearehere version.

## What we can't do (be honest in the implementation)

- **Beat opaque tracker IDs.** Many tracking cookies use random/hashed names (`session_<uuid>`, vendor-specific obfuscation). Name matching catches the long tail of well-known patterns, not adversarial naming.
- **Catch first-party-renamed trackers.** If `adoptersite.com` proxies Google Analytics and rewrites the cookie name to `_session_id`, our list won't flag it. The third-party domain heuristic was already weak against this; Phase 0 doesn't fix it. (Mitigation would require CNAME-cloak detection — out of scope.)
- **Classify session cookies meaningfully.** Most session cookies are first-party auth and indistinguishable by name alone. We mark them as "session/auth" and move on.
- **Cross-browser ID linkage.** Detecting that `_ga` on site A and `_ga` on site B are the same Google Analytics property requires reading the cookie *value* and parsing it. Out of scope; doesn't fit the threat model wearehere addresses.

## Survey learnings driving Phase 0

Captured from the discussion that led to this PRD; here so a returning reader doesn't re-derive them.

- **Maintenance-mode ≠ Chrome outplayed it.** Cookie AutoDelete and JShelter are stalled on MV3 port effort and maintainer time, *not* on API death. `chrome.cookies` and `chrome.scripting` MAIN-world are fully alive in MV3. Lifting the knowledge is reasonable; the techniques still work.
- **Lift knowledge, not plumbing.** The valuable part of these projects is the curated data — lists, taxonomies, surface enumerations. The MV2 background-page plumbing is throwaway.
- **Source-of-truth correction.** The original PRD draft pointed at Cookie AutoDelete for the cookie-name list. Investigation showed CAD bundles no curated list — it's a framework, not a dataset. The Open Cookie Database (which seeds most consent-tool ecosystems) is the correct source. The pattern of "verify the prior art before committing the integration" earned its keep here.
- **Lists are facts, code is code.** GPL-3 source doesn't infect MIT consumers when we lift a *list* with attribution. If we ever lifted source files verbatim, they'd need to live in a GPL-3 sub-package.
- **Phase 0 is the unblock.** Both wearehere's classification upgrade and wearecooked v5's scoper need the same name list. Doing the extraction once in wearehere unblocks both.
- **Detection stays detection.** Resisting the urge to add intervention here protects wearehere's truth-of-observation premise. wearehere's job is "tell the user what's happening"; the moment it starts altering reality, its own scores become meta. Intervention lives in wearecooked v5.

## Out of scope for Phase 0

- Fingerprint surface list extraction from JShelter (that's a wearecooked v5 concern; wearehere's existing fingerprint detection in `inject.js` is already adequate for observation)
- Cookie scoping / lifecycle controls (wearecooked v5)
- Storage purging (wearecooked v5 stretch)
- Score formula changes — start by surfacing categories; revisit weights after real data
- Public Suffix List bundling (not needed for name matching; needed for wearecooked's third-party correctness)
- npm package (`wearehere` package) — the new field becomes available automatically through the existing `assess` shape; no API contract change needed

## Concrete next steps (do not execute from this PRD)

1. ✅ Pull Open Cookie Database into `chrome-extension/cookie-database.js` (+ Firefox mirror). NOTICE updated.
2. ✅ Pull JShelter fingerprint-surface enumeration into `chrome-extension/fingerprint-surfaces.js` (+ Firefox mirror). NOTICE updated.
3. ⏳ Wire `classifyCookie()` into `background.js` `fetchCookies()` — name lookup, category aggregation in `tabData[tabId].cookies`. Out of scope for the data-extraction commit; separate change.
4. ⏳ Surface category breakdown in popup (`cookiesSection`) and report cookies tab.
5. ⏳ Ship as wearehere v3.3.0. No new permissions, no new tabs, no new score categories.
6. ⏳ wearecooked v5 vendors the same `cookie-database.js` snapshot as its phase 1 input.

## Open questions

- **Canonical home of the list.** Recommendation: wearehere. wearecooked vendors. Alternative: a `wearelists` data-only package both consume. Decide before Phase 0 ships; the file path determines the import shape in both downstreams.
- **List update cadence.** Tied to wearehere release cadence (currently roughly monthly). No upstream sync automation in Phase 0.
- **Display polish.** "8 ad-tech" / "3 analytics" / "1 session" is the obvious phrasing. Real wording lives in the Cookies tab UX pass, not this PRD.

## Simplifying wearehere — popup shape (decided 2026-05-12)

Current popup carries 10 cards (Cookies, Network, Trackers, Pressure, Selling, Profiling, Stored data, Watching, Clicks, Terms). Non-tech users scan for three things — *who's watching, what they're learning, where it goes* — and the 10-card layout buries that signal in researcher-grade detail. The cap counter from wearecooked v5 phase 1 (cookie scoper) also needs popup real estate. Decision: consolidate to 3 blocks + a footer chip row + the scoper card.

### Final popup shape

```
┌─ HEADER ───────────────────────────────
│  cnn.com                    40 MODERATE
│  Typical tracking. Clearing cookies helps.
└────────────────────────────────────────

┌─ Who's watching ───────────────────────
│  Google · Meta  +3 more
│  cookies · pixels · device ID · typing · clicks
└────────────────────────────────────────
  ✓ Not sold   ✓ Terms OK   ⚠ Mild pressure

┌─ Cookie scoper ────────────────────────
│  nytimes.com · 7 day cap
│  longest cookie 400d → 7d · 19 tightened, 3 killed
│
│  [ Sweep now ]   [ Trust 30d ]
│
│  ──────────────────────────────────────
│  113 tightened · 31 killed · last sweep just now
└────────────────────────────────────────
```

### Vocabulary

Mechanism chips use short, recognizable terms — same vocabulary across popup and dashboard tabs:

- **cookies** — name-matched tracker cookies (OCD-curated)
- **pixels** — third-party network requests to tracker domains (recognizable from "Meta pixel" press; covers iframes/scripts too — close-enough mental model)
- **device ID** — fingerprint-surface reads (canvas, audio, font enumeration, etc.)
- **typing** — input-field watchers
- **clicks** — outbound link tagging

A company appears under *Who's watching* if **any** of these fire for them. The chip line lists the deduped union of mechanisms actually detected. Fewer signals on lighter sites — chips don't pad.

### "Who's watching" — naming + count rules

| Watchers | Display |
|---|---|
| 0 | `No trackers detected ✓` (chip line hidden) |
| 1 | `Google` (no count) |
| 2 | `Google · Meta` (no count) |
| 3+ | `Google · Meta  +N more` |

Ranked by mechanism-count (a company seen via cookies + pixels + device ID outranks a network-only blip).

### Footer chip row — Where it goes + Site behavior

Collapses *Selling*, *Terms*, *Pressure* into a one-line chip strip. Only renders chips for signals that fired:

- `✓ Not sold` / `⚠ Sold to brokers` (selling detection)
- `✓ Terms OK` / `⚠ Terms hostile` (terms score)
- `✓ No pressure` / `⚠ Mild pressure` / `⚠ Aggressive pressure` (manipulation badges)

If all three are `✓`, collapse to a single `✓ All clear` chip. If any is `⚠`, that chip can expand on click into a full card with detail (escape hatch when the user wants the *why*).

### Cookie scoper card — state matrix

| State | Site line | Impact line |
|---|---|---|
| Untouched (pre-sweep) | `nytimes.com · 7 day cap` | `longest cookie 400d → will trim to 7d` |
| After sweep | `nytimes.com · 7 day cap` | `longest cookie 400d → 7d · 19 tightened, 3 killed` |
| Clean site (all ≤ 7d already) | `example.com · 7 day cap` | `all cookies within cap ✓` |
| Trusted | `nytimes.com · trusted 27d left` | `cookies passing through · 0 tightened` |

Action row rules:

- `[ Sweep now ]` is always present.
- `[ Trust 30d ]` shows when the site is **not** trusted.
- `[ Remove trust ]` replaces `[ Trust 30d ]` while a trust window is active.
- `Trust 90d` does **not** ship in the popup — the per-site whitelist tab carries longer-duration trust tiers.

Per-site counts (`19 tightened, 3 killed`) only show numbers when non-zero (`, 3 killed` is omitted on tighten-only sites). Footer carries global counters (`113 tightened · 31 killed · last sweep <relative time>`).

### What the popup deliberately does *not* show (lives in dashboard tabs)

- Raw cookie/request/domain counts (Cookies tab Overview)
- Session vs persistent cookie split (Scoper tab)
- Per-cookie expiry distribution (Scoper tab)
- Scan telemetry (`scanned 1048 · rewrote 3 · demoted 0`) (Scoper tab)
- 1p anchor / cron gate progress (Scoper tab)
- Trust-list management — which sites trusted, when each expires (Whitelist tab)
- Per-mechanism breakdowns — which specific cookies/pixels/surfaces fired per company (Trackers tab)
- "1 of 15 links tag your clicks" — granular counts (Trackers tab)

Popup is the *glance + one action*; dashboard tabs are the *proof + management*. Binary signal up top, rich detail one click away.

### Score line — keep the number

`40 MODERATE` stays. The number is the wearehere signature; the verdict ("Typical tracking. Clearing cookies helps.") is the carrier for non-tech users, but the number lets returning users compare across sites and across visits. Both layers earn their pixels.

### Cookie scoper dashboard tab (decided 2026-05-12)

Standalone tab — four blocks, no per-site context card (popup carries that), no default-cap knob (locked at 7d per wearecooked v5 PRD), no trust-expiry column (trust is permanent until removed; user removes manually).

```
┌─ Cookie scoper ──────────────────────────────────────────────────────────┐
│                                                                          │
│   157            45                 47                last sweep         │
│   tightened      trackers killed    sites watched     12m ago            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Trusted sites · 9 ──────────────────────────────────────────────────────┐
│                                                                          │
│   Domain               Trust    Cookies stored    Actions                │
│   ─────────────────    ──────   ───────────────   ──────────────────     │
│   gmail.com            90d      42                [→ 30d]  [✕]           │
│   github.com           30d      18                [→ 90d]  [✕]           │
│   notion.so            30d      9                 [→ 90d]  [✕]           │
│   …                                                                      │
│                                                                          │
│   Add  [_______________________________]  [30d ▾]   [Add]                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Settings ───────────────────────────────────────────────────────────────┐
│                                                                          │
│   Sweep period      ( ) every 15 min   (•) hourly                        │
│                     ( ) every 4 hrs    ( ) every 12 hrs                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Recent activity ──────────────────────────────────────────────── [▾] ───┐
│                                                                          │
│   1p anchor: 47 sites watched · gate opens at 10 (open)                  │
│                                                                          │
│   When        Trigger     Scanned    Rewrote    Demoted                  │
│   ─────────   ─────────   ────────   ────────   ────────                 │
│   14:32:01    alarm       1047       12         3                        │
│   13:32:01    alarm       1043       0          0                        │
│   12:32:01    alarm       1041       4          1                        │
│   11:32:00    manual      1039       0          0                        │
│   10:32:00    alarm       1035       0          0                        │
│   09:32:00    alarm       1029       8          2                        │
│   …                                                                      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Block rules:**

- **Lifetime hero** — four numbers across: `tightened`, `trackers killed`, `sites watched`, `last sweep` (relative timestamp). `sites watched` counts unique domains touched lifetime; proves coverage without overpromising deletion volume.
- **Trusted sites** — primary management surface. Inline `[→ 30d]` / `[→ 90d]` toggles tier; `[✕]` removes trust. Add-domain row at the bottom with tier selector defaulting to 30d.
- **Settings** — only `Sweep period` ships in phase 1. Default is `hourly`. The 7d cap is **not** user-tunable (architecture decision in wearecooked v5 PRD).
- **Recent activity** — collapsed by default. Lists last N sweep events with trigger source (`alarm` for scheduled, `manual` for sweep-now). 1p anchor / cron gate state surfaces in the section header so power users can see whether the gate is open.

**Per-site detail does not live here.** The popup is the per-site surface (current tab → its scoper card). The dashboard tab is lifetime + management + telemetry. No "this site" widget on the tab.

**Trust durations:** popup offers `30d` only; tab offers `30d` and `90d`. Bumping from 30d to 90d is a considered action and belongs on the management surface.

#### Cookie scoper tab — Cookies-in-browser block (decided 2026-05-12)

The old `Cookies` tab (browser-wide 967-cookie dashboard with 10-category legacy classification + Clean Cookies CTA) folds into Cookie scoper as a new block titled **"Cookies in your browser"**. Tab name stays `Cookie scoper`; the block sits **after** the lifetime hero and **before** Trusted sites. Reading flow: *impact → population → management → tune → audit*.

Final tab layout (5 blocks):

```
┌─ Cookie scoper ──────────────────────────────────────────────────────────┐
│                                                                          │
│   157            45                 47                last sweep         │
│   tightened      trackers killed    sites watched     12m ago            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Cookies in your browser · 967 total ───────────────────────────────────┐
│                                                                          │
│   Coverage           643  ████████████████  capped (1p · 7d)            │
│                       47  █                trusted (passing through)    │
│                      277  █████            third-party (kill on close)  │
│                                                                          │
│   By expiry          <7d   ████████████████████████  643                │
│                      30d   ██████  127                                   │
│                      90d   ████  74                                      │
│                      1yr+  ███  76  (in trusted or 3p — out of cap)     │
│                                                                          │
│   Top owners         Google 312 · Meta 89 · Adobe 47 · Microsoft 31 · …  │
│                                                                          │
│                                                  [ Inspect all 967  ▾ ] │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Trusted sites · 9 ──────────────────────────────────────────────────────┐
│   …                                                                      │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Settings ───────────────────────────────────────────────────────────────┐
│   Sweep period      ( ) every 15 min   (•) hourly                        │
│                     ( ) every 4 hrs    ( ) every 12 hrs                  │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Recent activity ──────────────────────────────────────────────── [▾] ───┐
│   …                                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Sub-block rules:**

- **Coverage** — 967 split by scoper-action bucket: `capped (1p · 7d)`, `trusted (passing through)`, `third-party (kill on close)`. Visualizes the system's working set; bar widths proportional to count. This is the most load-bearing line of the block — it answers "what is the scoper actually doing to my browser right now."
- **By expiry** — four buckets: `<7d`, `30d`, `90d`, `1yr+`. Bucket boundaries map to the user-actionable knobs (7d cap, 30d/90d trust tiers, 1yr+ = long tail). The `1yr+ · N (in trusted or 3p — out of cap)` row is the wearecooked story in one line: "here's where long-lived cookies still hide."
- **Top owners** — single-line vendor concentration, top 5–7 by cookie count. Plain text with `·` separators. Earns its line without burning a bar chart.
- **`[ Inspect all 967 ▾ ]`** — expander to the full raw table (vendor · category · expiry · domain · scoper-action). Collapsed by default; replaces the old per-cookie inline list.

**Dropped from the old Cookies tab:**

- **10-category legacy classification** (Analytics/Tracking, Advertising, Social Media Tracking, etc.) — OCD vendor + scoper-action breakdown supersedes it. Eliminates the dual-vocabulary redundancy.
- **`TRACKING/ADS 243 (25%)` stat card** — duplicated by lifetime `trackers killed` and OCD vendor concentration.
- **`Clean Cookies` CTA** — `Sweep now` in scoper does the same action with the system's vocabulary. One verb, one button.
- **Per-cookie inline table** — pushed behind the `Inspect all 967 ▾` expander.

After this fold, the standalone `Cookies` dashboard tab is removed.

### Watchers tab — formerly Trackers (decided 2026-05-12)

Renamed `Trackers` → `Watchers` for vocabulary consistency with the popup's "Who's watching." Tab is global (cross-tab, cross-session) and answers a different question than the popup: not *who's on this site* but *who follows me across the web*.

Two stories the tab could tell — **persistence** (same companies across many sites) and **amplification** (one visit, many hidden contacts). Persistence is the headline; amplification is supporting detail. Per-site amplification already lives in the popup's "Who's watching" card — the tab differentiates by taking the cross-time, cross-site view.

```
┌─ Watchers — who follows you across the web ─────────────────────────────┐
│                                                                          │
│   23              184              17              1 visit ≈ 8           │
│   sites visited   hidden contacts  unique watchers  hidden contacts      │
│                                                                          │
│   Window:  ( ) today   (•) week   ( ) month   ( ) all time               │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Who follows you · 17 watchers ─────────────────────────────────────────┐
│                                                                          │
│   Company             Reach                       Mechanisms             │
│   ─────────────────   ─────────────────────────   ──────────────────     │
│   Google              ████████░░  78%  (18/23)    cookies · pixels · ID  │
│   Meta                █████░░░░░  48%  (11/23)    pixels · ID            │
│   Adobe               ███░░░░░░░  30%   (7/23)    pixels                 │
│   Microsoft Clarity   ██░░░░░░░░  17%   (4/23)    pixels                 │
│   …                                                                      │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Recent visits ─────────────────────────────────────────────────────────┐
│                                                                          │
│   Site                Tag-alongs    Top watchers                         │
│   ──────────────────  ──────────    ────────────────────                 │
│   cnn.com             47            Google · Meta · +12 more             │
│   nytimes.com         31            Google · Meta · +8 more              │
│   amazon.com          22            Amazon-self · Google · +5            │
│   github.com          3             GitHub-self                          │
│   …                                                                      │
│                                                                          │
│   [ Clear history ]                                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Block rules:**

- **Hero strip** — four stats: `sites visited`, `hidden contacts` (deduped third-party domain hits), `unique watchers` (companies), and an amplification ratio (`1 visit ≈ N hidden contacts`). The ratio is the visceral hook; the absolute numbers earn it.
- **Window selector** — `today / week / month / all time`. Persistence character changes at different scales; week is the default. Setting persists.
- **Who follows you** — primary block. Rows ranked by reach % (visits where the company was seen / total visits in window). Bar visualizes share, fraction shows raw numbers. Mechanism chips use the popup vocabulary (`cookies · pixels · device ID`) — vocabulary stays consistent across surfaces.
- **Recent visits** — secondary block. Per-site tag-along count + top 2 watchers + `+N more`. Carries the amplification story without burying persistence. `[ Clear history ]` resets the visit log without touching cookies/trust.

**Mechanism vocabulary — same across popup and tab:**

- `cookies` (OCD name-matched tracker cookies)
- `pixels` (third-party network requests to tracker domains)
- `device ID` (fingerprint-surface reads — abbreviated from "fingerprinting" for popup brevity; full term acceptable in tab tooltips)

**What the tab deliberately drops (vs. the previous Trackers tab):**

- **DNS query log** — normal lookups are noise; if a DNS hit matters, it's already captured under pixel/network attribution.
- **Per-request raw log** — researcher-grade, not user-grade. If needed for debugging, exposed via a dev-tools export, not the tab.
- **"Network requests: 12,847"** — a number without amplification context. Replaced by `184 hidden contacts` framed against `23 sites visited`.
- **Per-tab live view** — current tab is the popup's job; the global tab is across-time, across-site only.

**Phasing:**

- Persistence block + hero strip require per-domain visit history × tracker attribution joined across sessions. Data sources for the big watchers (Google, Meta, Adobe, etc.) are already compiled in `network-domains.js` and the OCD vendor map — the join is implementable now.
- Recent-visits block is implementable today against the existing per-tab attribution.
- Persistence chart ships in the same phase as recent visits; no 1.5 split needed.

#### Watchers tab — Terms fold-in (decided 2026-05-12)

The standalone `Terms` and `Network Map (graph)` tabs both retire. Graph drops entirely — force-directed network visualizations are screenshot-pretty but rarely actionable, and Watchers' persistence chart already covers "who connects to what" with a stronger frame. Terms folds into Watchers as a fourth block — pairing **who watches each site** with **what each site claims** under one tab. Tab name stays `Watchers`.

Final Watchers tab layout (4 blocks):

```
┌─ Watchers — who follows you across the web ─────────────────────────────┐
│   hero stats + window selector                                           │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Who follows you · 17 watchers ─────────────────────────────────────────┐
│   companies ranked by reach % + mechanism chips                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Recent visits ─────────────────────────────────────────────────────────┐
│                                                                          │
│   Site                Tag-alongs    Top watchers              Terms      │
│   ──────────────────  ──────────    ────────────────────      ──────     │
│   cnn.com             47            Google · Meta · +12       18  ⚠      │
│   nytimes.com         31            Google · Meta · +8        42  ⚠      │
│   amazon.com          22            Amazon-self · Google · +5 67  ✓      │
│   github.com          3             GitHub-self               78  ✓      │
│   …                                                                      │
│                                                                          │
│   [ Clear history ]                                                      │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Terms · cnn.com ─────────────────────────────────── [site selector ▾] ─┐
│                                                                          │
│   Score 18/100   ⚠ Hostile                                              │
│                                                                          │
│   ⚠ Forced arbitration               clause 12.4                         │
│   ⚠ No class action waiver           clause 12.5                         │
│   ⚠ Data sharing with partners       clause 7.2                          │
│   ⚠ 2-year data retention            clause 9.1                          │
│   ⚠ Terms change without notice      clause 14.1                         │
│   ✓ Account deletion offered         clause 8.3                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Changes from initial Watchers spec:**

- **Recent visits gains a `Terms` column** — per-row score + icon (`18 ⚠` / `67 ✓`). At-a-glance hostile-terms signal.
- **Terms block added** at the bottom. Defaults to the most-exposed site (top of Recent visits); selector dropdown switches sites; clicking a row in Recent visits re-points the selector.
- **Empty history fallback** — when there's no recent visit data, Terms block defaults to current tab; if no current tab, shows a "Visit a site to see its terms" placeholder.

**Vocabulary alignment:**

- Terms score uses the same numeric scale and chip as the popup footer chip row (`18 ⚠`, `67 ✓`).
- Clauses rendered with `⚠` / `✓` icons, clause references as `clause 12.4` etc. — referenceable for users who want to read the actual ToS.

**Why fold here, not in Overview:**

Overview is the time-story tab (aggregate). Terms is per-site (drill-in). Watchers already hosts per-site context via Recent visits — Terms slots in naturally as another per-site dimension. Overview stays a pure trending tab; Watchers becomes the per-site reality tab.

### Updated tab inventory (decided 2026-05-12)

```
Locked dashboard tabs
├── Overview          time-based story (trending, what changed, score trend)
├── Watchers          who follows me + what each site claims (per-site reality)
├── Cookie scoper     impact, browser cookie population, trust mgmt, sweep activity
│
├── ✕ Cookies         removed — folded into Cookie scoper as "Cookies in your browser"
├── ✕ Network         removed — folded into Watchers as `pixels` mechanism
├── ✕ Terms           removed — folded into Watchers as fourth block
└── ✕ Network Map     removed — dropped entirely (Watchers persistence chart replaces)
```

From **6 tabs → 3 tabs**. Half the surface area, sharper stories per tab.

### Architecture update — Cookie scoper lives in wearehere (decided 2026-05-12)

Original Phase 0 framing routed cookie scoping to a separate wearecooked v5 extension and reserved wearehere for detection-only. **That decision is reversed:** wearecooked v5 will not ship; Cookie scoper ships inside wearehere. One install, one storage, no cross-extension messaging. The `port-kit/` branch on `hamr0/wearecooked` (phase 1, 23 commits, harness 21/21) is the **starting-point code** to transplant — not a cross-extension bridge.

Architectural decisions previously labeled "wearecooked v5 PRD" (7d cap locked, trust durations, four-block tab layout, sweep period radio) still hold; they were design decisions, only the host extension changed. The "detection stays detection" principle from Phase 0 is also revised: wearehere now intervenes (cookie expiry rewriting, tab-close 3p deletion) via the scoper. The intervention is scoped, named, and visible to the user — not silent. The truth-of-observation premise is preserved by labelling scoped/swept cookies explicitly in the dashboard.

### Build gaps — what's missing to ship the new design (audited 2026-05-12)

The new design is materially a rewrite. Today the extension is a per-tab, in-memory observer (`tabData[tabId]` only, no cross-session state). The new design needs persistent storage, cross-session visit history, window snapshots for diffs, and a new internal Cookie scoper module. Codebase audit summary:

**What exists already (do not rebuild):**

- OCD cookie classifier — `chrome-extension/cookie-database.js` (2,302 lines) + `classifyCookie()` integrated into `background.js:fetchCookies()`
- Network domain tracker registry — `chrome-extension/network-domains.js` (626 lines) + `classifyNetworkDomain()`
- Fingerprint surface enumeration — `chrome-extension/fingerprint-surfaces.js`
- Per-tab attribution — `tabData[tabId]` with modules (watched/cooked/played/leaked/linked/tosed/silent), networkData, cookies (snoops/embeds/essential)
- 8-card popup + 6-tab report rendering machinery (to be torn down and replaced)

**Permissions and storage gaps:**

- `[blocking]` `chrome-extension/manifest.json` — add `"storage"` permission
- `[blocking]` `chrome-extension/manifest.json` — add `"alarms"` permission (for scheduled sweeps)
- `[blocking]` `chrome-extension/background.js` — define cross-session storage schema:
  - `visitHistory: [{domain, visitTimestamp, score, trackers: [{company, mechanisms:[]}], sweepImpact, termsScore}]`
  - `windowSnapshots: {week, month, allTime}` (for Overview's "What changed" diffs)
  - `scoreHistory: [{timestamp, score}]` (for Score trend chart)
  - Plus Cookie scoper keys below
- `[blocking]` `chrome-extension/background.js` — on each new visit, append to `visitHistory`, update window snapshots, log score

**Popup (3-block rewrite):**

- `[blocking]` `popup.html` + `popup.js` — collapse 8 section builders into 3 blocks (Header / Who's watching / Footer chip row) + Cookie scoper card
- `[blocking]` `popup.js` — mechanism deduplication (cookies / pixels / device ID / typing / clicks) and company-by-mechanism-count ranking
- `[blocking]` `popup.js` — Cookie scoper card binding (Sweep now, Trust 30d ↔ Remove trust toggle, per-site counters, global counters). Currently unhooked — depends on internal scoper module (transplanted from port-kit, see PLAN.md Phase 2)
- `[degraded]` `popup.js` — footer chip row (Not sold / Terms OK / pressure) — needs cooked/watched mechanism split

**Overview tab:**

- `[blocking]` `report.js` — "What changed" event log: per-window state snapshot + diff computation (new watcher / reach change / cookies grew / score improved / sweep impact / new site). Requires `windowSnapshots` storage above.
- `[blocking]` `report.html`/`report.js` — hero strip (sites visited / avg score / watchers spotted / most exposed) + window selector
- `[degraded]` `report.js` — Score trend chart, requires `scoreHistory` per-day bucketing

**Watchers tab (formerly Tracking):**

- `[blocking]` `report.js` — "Who follows you" cross-session aggregation: per-visit attribution joined with `network-domains.js` + OCD, ranked by reach %. Requires `visitHistory` storage.
- `[blocking]` `report.js` — "Recent visits" table (Site / Tag-alongs / Top watchers / Terms score column)
- `[degraded]` `report.js` — Terms block + site selector; needs per-site `termsScore` persisted on each visit (data already computed by `tosed` module, just not stored)

**Cookie scoper tab (entirely new, internal module transplanted from port-kit):**

- `[blocking]` new dir `chrome-extension/scoper/` — transplant `popup-card/` and `dashboard-blocks/` from `hamr0/wearecooked` port-kit branch; rewire from cross-extension `sendMessage` to internal `chrome.storage.local`
- `[blocking]` `chrome-extension/background.js` — sweep alarm handler, cookie rewrite logic, tab-close 3p deletion (move from port-kit's separate service worker into wearehere's existing one)
- `[blocking]` Cookie scoper storage schema in `chrome.storage.local`:
  - `cookieScopeSweepLog: [{timestamp, trigger, scanned, rewrote, demoted}]`
  - `trustList: [{domain, duration: '30d'|'90d', addedTime}]`
  - `cookieScopeSettings: {sweepPeriod: '15min'|'hourly'|'4hr'|'12hr'}`
  - `cookieScopeCounters: {tightened, killed, sitesWatched, lastSweep}`
- `[blocking]` `report.js` — "Cookies in your browser" block: coverage (capped / trusted / 3p), by-expiry buckets, top owners. Requires scoper-action labels emitted by the internal scoper module during sweep
- `[blocking]` `report.js` — Trusted sites table (add / remove / 30d ↔ 90d tier toggle), Settings (sweep period radio), Recent activity log

**Removed surfaces (do not port to new design):**

- `Cookies` tab — folded into Cookie scoper "Cookies in your browser" block
- `Network` tab — folded into Watchers as `pixels` mechanism
- `Terms` tab — folded into Watchers as fourth block
- `Network Map` tab — dropped entirely
- 8-card popup layout — replaced by 3-block layout

### Build sequence

Full build sequence and dependency graph live in [PLAN.md](./PLAN.md). Headline order:

1. **POC** — validate the sweep cycle (set cookie → rewrite expiry → confirm persistence) before committing to structure
2. **Phase 1 — Foundations** — `storage` + `alarms` + `cookies` permissions; `chrome.storage.local` schema (visit history, snapshots, score history, scoper keys)
3. **Phase 2 — Cookie scoper module** — transplant port-kit code as internal `chrome-extension/scoper/`; rewire bridge calls to internal storage; sweep handler in `background.js`
4. **Phase 3 — Popup rewrite** — 3 blocks + scoper card (transplanted card slots in)
5. **Phase 4 — Watchers tab** — cross-session aggregation + Terms fold
6. **Phase 5 — Overview tab** — diffs + score trend
7. **Phase 6 — Cleanup** — drop unused tabs, CSS, permissions
8. **Phase 7 — Firefox mirror** — once Chrome is stable

All implementation work follows `.claude/memory/AGENT_RULES.md` — POC first, vanilla→stdlib→external dependency hierarchy, surgical changes, mobile-responsive UI verified in DevTools before claiming UI tasks done.

### Overview tab — time-based story (decided 2026-05-12)

Every other tab answers *"what is the current state of X?"* Overview is the only surface answering *"how am I trending and what changed?"* That delta lens is what earns the tab — a faithful "summary of cards" Overview would be redundant since popup + Watchers + Cookie scoper already own current-state per their respective scopes.

Three blocks: hero + What changed + Score trend. Most-watched folds into the hero strip as the fourth stat (not its own block).

```
┌─ This week ─────────────────────────────────────────────────────────────┐
│                                                                          │
│   38              ↓ 4 pts          2 new            cnn.com              │
│   sites visited   avg score 47     watchers spotted most exposed         │
│                                                                          │
│   Your 3 most-watched: cnn.com · nytimes.com · amazon.com                │
│                                                                          │
│   Window:  ( ) week   (•) month   ( ) all time                           │
└──────────────────────────────────────────────────────────────────────────┘

┌─ What changed ──────────────────────────────────────────────────────────┐
│                                                                          │
│   ↗ New watcher    Criteo first seen on 3 sites this week                │
│   ↗ New watcher    TikTok Pixel first seen on 2 sites this week          │
│   ↘ Less reach     Google reach 82% → 71% (you trusted gmail)            │
│   ↗ More cookies   nytimes.com now stores 31 (was 19)                    │
│   ✓ Sweep impact   Swept facebook.com — killed 47 tracker cookies        │
│   ⊕ New site       First saw amazon.com this week                        │
│   …                                                                      │
│                                                                          │
│   [ Show all (23) ]                                                      │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Score trend ───────────────────────────────────────────────────────────┐
│                                                                          │
│   60 ┤                                                                   │
│   50 ┤              ╭───╮                                                │
│   40 ┤        ╭────╯    ╰───────╮                                        │
│   30 ┤   ╭───╯                  ╰───────                                 │
│      └────────────────────────────────────                               │
│       Apr 12    Apr 19   Apr 26   May 03   May 10                        │
│                                                                          │
│   Average score this month: 47 · last month: 51 · ↓ 4 (better)           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

**Hero strip — four stats:**

1. `sites visited` — count in current window
2. `avg score` — average wearehere score across visits in window, with delta arrow vs. prior window
3. `watchers spotted` — count of *new* watchers (not seen in prior window). Drives the "what's new on your trail" feeling
4. `most exposed` — single site name (highest `visits × tag-alongs` in window). The "if you do one thing this week, look here" signal

One-line callout below: `Your 3 most-watched: <site> · <site> · <site>` — top three by the same `visits × tag-alongs` ranking. Clicking a site name jumps to its detail view (or to Watchers filtered to that site, depending on routing).

**What changed — event log rules:**

Each entry is a diff between this-window state and prior-window state, computed at tab-open (cheap with current storage). Only events above thresholds render:

| Event | Trigger | Icon |
|---|---|---|
| New watcher | Company seen ≥ 2 sites this window, 0 last window | ↗ |
| Watcher gone | Company seen ≥ 2 sites last window, 0 this window | ↘ |
| Reach grew | Company reach increased ≥ 10 percentage points | ↗ |
| Reach shrank | Company reach decreased ≥ 10 percentage points | ↘ |
| Cookies grew | Per-site cookie count ≥ +10 | ↗ |
| Score improved | Per-site score dropped ≥ 5 pts on frequently-visited site | ↘ |
| Sweep impact | Manual or scheduled sweep removed > 0 cookies | ✓ |
| New site | Site visited first time this window, ≥ 2 visits | ⊕ |

Ranked by **magnitude × user-visit-frequency** so events on sites you visit often outrank one-off blips. Cap visible entries at 8; rest behind `[ Show all (N) ]`. Icons (↗ ↘ ✓ ⊕) carry directional signal — no color dependence, accessible by default.

**Score trend:**

Small line chart, current window vs. prior. Y-axis is wearehere score (lower = better, consistent with popup convention). One data point per day or per week depending on window. Footer line restates the comparison numerically (`average this month: 47 · last month: 51 · ↓ 4 (better)`) so the chart is supporting evidence, not the only signal. Nice-to-have, not load-bearing — ship without if score-over-time storage isn't already in place.

**Phasing / data dependencies:**

- Hero stats (visits, avg score, watchers spotted, most exposed) — implementable today, all derivable from existing per-tab attribution + visit history.
- What-changed event log — requires a snapshot of prior-window state to diff against. Modest storage work, no new permissions.
- Score trend — requires per-day or per-visit score logging. Ship after the other two blocks if storage isn't already shaped for it.

---

## v4.x — deferred polish (audited 2026-05-13)

After v4.0.0 shipped (Phases 1–5 complete + window-snapshot storage + Phase 6 cleanup + code-review hardening + onboarding + impact line), these items remain unimplemented. None block the current user story; each is small, low-priority UX polish or scope explicitly punted for Firefox parity.

### Shipped post-Phase-5 (closing user-feedback gaps surfaced 2026-05-13)

- **First-run onboarding modal** — single-pane dashboard overlay, shown once per install, three-line explanation of score / watchers / scoper. Persisted via `dashboardOnboarded: true` in `chrome.storage.local`. Esc or `[ got it ]` dismisses.
- **Overview impact line** — green-bordered callout on Overview rendering the scoper's windowed work in plain language: *"this week: wearehere shortened N cookies and demoted M trackers to session-only so they can't recognise you tomorrow."* Hidden when both counts are zero.

### Deviations from PRD that are deliberate, not deferred

- **"All clear" chip collapse** when all three footer chips are ✓. Opted out in `popup.js:163-165` ("Option B: always show every chip — predictable layout, ✓s are themselves affirmation"). The user learns the row shape once and reads it consistently. **Keep as-is.**
- **Score trend per-day bucketing via separate `scoreHistory` storage key.** Shipped version uses per-visit dots from `visitHistory` directly — same signal, no schema duplication. **Keep as-is.**

### Polish — pick up when there's runway

| Item | Severity | Where | Notes |
|---|---|---|---|
| Footer chip expand-on-click for ⚠ chips | low | `popup.js`, `popup.html` | PRD: "any ⚠ chip can expand on click into a full card with detail (escape hatch when the user wants the *why*)." Today chips are plain text. Add click handler that opens dashboard with the relevant tab/anchor. |
| What-changed event log `[ Show all (N) ]` expander | low | `report.js:renderWhatChanged` | Currently caps at 20 entries with no expander. PRD spec: cap visible at 8, rest behind expander. |
| What-changed ranking by **magnitude × visit-frequency** | low | `report.js:diffAggregates` | Today events are appended in detection order. PRD: rank by `magnitude × user-visit-frequency` so events on frequently-visited sites outrank one-off blips. Needs per-site visit-count from snapshot. |
| Score trend prior-window comparison footer | low | `report.js:renderScoreTrend` | Footer shows "avg N · range X→Y" but not "avg this month vs last month". PRD spec: `average this month: 47 · last month: 51 · ↓ 4 (better)`. Needs a second snapshot read for the prior-window avg. |
| Cookie scoper "Inspect all N cookies" expander | low | `report.js`, scoper tab | PRD spec: collapsed-by-default expander revealing the full per-cookie table (vendor · category · expiry · domain · scoper-action). Today the block ends after Top owners. |

### Shipped post-4.0.0 (closing remaining 4.x gates)

- **Phase 7 — Firefox mirror** — shipped in 4.1.0. `firefox-extension/` now mirrors the Chrome bundle byte-for-byte except `background.js` (the `importScripts` guard) and `manifest.json` (MV3 dialect + AMO fields). Drift verified via `diff -rq`. AMO re-submission unblocked.
- **Race-condition cleanup** — four fixes landed in 4.1.0: window selector re-paint, snapshot recompute debounce, watchers/terms selector independence, closed-tab selector orphan + cache invalidation. See `CHANGELOG.md [4.1.0]` for the full list.

### Scope explicitly punted

- **8-step manual smoke test** — the integration path in `PLAN.md` / `test/SMOKE.md` is still a human-in-the-loop checklist. The unit suite (`npm test`, 18/18 passing) covers the data pipeline; the UI-surface smoke can't be automated without a Chrome harness. Run both Chrome and Firefox bundles through it after each store-submission cycle.

### Non-goal — no active request blocking (decided 2026-05-13)

wearehere **does not** block tracker requests at the network layer (`declarativeNetRequest` / `webRequest` block rules). uBlock Origin already solves request-blocking with curated lists and a serious engineering investment in filter rules + site-breakage management. Re-implementing that surface would invite the same maintenance burden without the same depth — wearehere's value would diverge into "another blocker, less mature" instead of the niche it actually fills.

**Posture stays: honest observer + light intervention.** The scoper rewrites tracker cookies to short caps + session expiry, so trackers can't recognise you tomorrow. The dashboard names every watcher and shows the mechanisms they use. That's the differentiated story.

Implications:
- Pair with uBlock (or any blocker) for actual request prevention. wearehere is complementary, not competitive.
- Branding stays "privacy that acts back" — the act *is* cookie scoping + dashboard transparency. Active blocking is not implied.
- No `declarativeNetRequest` permission. No rule-set bundling. Keeps the AMO / Chrome Web Store review surface minimal.

### Phase 6 cleanup — pending

Audit + remove dead CSS classes, retired-tab images (`baked.png`, `cooked.png`, `played.png`, `linked.png`, `silent.png`, `tosed.png`, `watched.png`, `leaking.png`), and any manifest permissions no longer reachable from live code. Single contained commit. Pre-requisite before the Firefox mirror — porting dead code wastes effort.

### Pre-Firefox-mirror code review — findings logged 2026-05-13

Full review (`quality-assurance` subagent, scope `2d81a5a..c0a7133`) surfaced 8 Critical + 17 Important findings. Fixed in-line before this commit landed:

- **Dead `gated/anchorSize` branch** in `popup.js` — 1p-anchor + cron-gate machinery was dropped from `scoper.js` but the popup still rendered the gated state. Removed.
- **`tabs.onRemoved` ordering** — `markTabRemoved` now runs *before* `snapshotAndEvict`; a late `detection` message during the async session-storage read can no longer resurrect a torn-down tab and trigger a badge-write rejection.
- **`activeTab` permission** — declared in manifest but unused (we have `<all_urls>` host permissions). Dropped before AMO submission to minimise the requested-permission set.
- **`registerDashboard` reuse path** — handler existed but no caller; every `openDashboard` opened a fresh tab. `report.js:init` now sends `registerDashboard` so the single-dashboard-tab optimisation works.
- **`fetchCookies` substring match** — `c.domain.includes(domain)` conflated `foo.com` with `mfoo.com` / `evil-foo.com`. Switched to last-two-labels eTLD+1 comparison via a new `etld1ForCookie` helper.
- **Trust-list write race** — concurrent `scoper:set-trust` calls could clobber each other; now serialized through a module-level `trustWriteChain` promise.
- **`visitHistory` write race** — concurrent tab-close `appendVisit` calls could lose visits; now serialized through `appendChain`.
- **`bgFetch` redirect re-check** — was `redirect: 'follow'`, so a server 30x to a private IP would be followed silently after the initial public-IP check. Switched to `redirect: 'manual'` via new `safeBgFetch` helper which re-runs `isSafeBgFetchUrl` on every `Location` hop (up to `MAX_BG_REDIRECTS = 5`).
- **`renderWhatChanged` placeholder copy** — `${overviewWindow}` interpolated raw into innerHTML. Constrained to `WINDOW_OPTIONS` today, but wrapped in `escapeText` for defense-in-depth.
- **Snapshot watcherMech case-sensitivity** — case variants of a watcher name (`Google`/`google`) deduped on `hits` but the per-company mech rollup looked up by original-case key, missing the dedup'd entries. Lowercased the lookup table.

### Deferred (review findings worth tracking but not fixing pre-FF mirror)

These are real findings the review surfaced; they're documented here so the Firefox port either inherits the same shape or addresses them concurrently.

| Finding | Severity | Reason for deferring |
|---|---|---|
| **Tab-close 3p deletion not implemented** — scoper has no `tabs.onRemoved` handler that targets cookies. PRD line 461 and the dashboard "kill on close" label promised tab-close semantics. UI copy now reads "demoted to session" (= killed on browser close, not tab close), which matches what the code actually does. | Critical → spec correction | Per-tab cookie attribution is a major engineering effort and not what the user actually wants (session-on-browser-close is the common privacy mental model). PRD will reflect the actual behavior in a future revision. |
| **`partitionKey` (CHIPS Partitioned cookies) not preserved on rewrite** | Critical | `chrome.cookies.set` doesn't carry `partitionKey` through; rewritten partitioned trackers collapse into a single unpartitioned cookie. Edge case today (CHIPS rollout is partial) but a real regression hazard. Track separately. |
| **`persistPendingVisit` writes session-storage on every `detection` message** — heavy SPAs may approach Chrome's per-minute write cap. | Important | No observed quota hit; debounce is one-line additive — defer until we see it. |
| **SPA `pushState` navigation produces one visit record** for the entire session — `tabs.onUpdated` only fires for `url` changes Chrome treats as navigations. | Important | Requires `webNavigation` permission to fix; adds another permission to the AMO ask. Acceptable trade-off today. |
| **`scoper:ensureAlarm` may reset the next-fire delay on every SW wake** — `chrome.alarms.create` with an existing name silently replaces. | Important | Mirror the `chrome.alarms.get` pre-check pattern that `SNAPSHOT_ALARM` uses in `background.js`. Straightforward fix; not blocking. |
| **`buildSetDetails` returns `null` for `sameSite=no_restriction && !Secure` combos** and the caller counts them as `failed` instead of `skipped` — telemetry shows phantom failures. | Important | Counter cosmetic; doesn't affect actual sweeping. |
| **Popup trust-input validates URL-shape weakly** — accepts `localhost.com`, `..invalid..foo.com`, IPs. | Important | User-facing self-inflicted, not a security issue; fix in same pass as the `[ Inspect all N ]` expander work. |
| **`buildReport` device-id hostToCompany uses last-two-labels** — mis-buckets `.co.uk` etc. Acknowledged limitation throughout the codebase. | Minor | PSL not vendored anywhere; one-shot fix would touch every etld1 site simultaneously. |
| **No CSP declared in manifest** | Minor | MV3 default CSP is strict (no eval/inline). Optional defense-in-depth. |
| **Stack-walk wrap set in `inject.js` is intentionally minimal** — no `getImageData` / `toBlob` / `OffscreenCanvas` / WebGL2 surfaces. | Minor | Per PRD vocabulary lock. Lock-set asserted in code review; tests for the locked set don't exist yet. |
| **`renderRecentVisits` etld1 calc** uses last-two-labels — same `.co.uk` limitation. | Minor | Same as above. |
| **`compactVisit` brokerCount falls back to `network.brokerCount` when typed `brokers` is empty** — UI can show "5 brokers" with zero names. | Minor | Real but rare; one-line correction. |
| **Test-coverage gaps** — `safeBgFetch` redirect chain, `removedTabs` LRU eviction, `snapshotAndEvict` session-storage recovery path, `cookieScopeCounters.bySite` accumulation, `buildSetDetails` `__Host-` violations, message-handler vs sender exhaustive cross-check. | Minor | Current 18-test suite covers the data pipeline; these are higher-effort tests for less-trafficked paths. Add after Firefox mirror so both extensions benefit. |

