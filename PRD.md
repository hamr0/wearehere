# wearehere — Phase 0 PRD

> Status: planning. wearehere v3.2.0 ships a 10-category privacy scanner. Phase 0 extends the **Cookies** category with curated tracker-name classification borrowed from Cookie AutoDelete. Detection only — no intervention, no behavior change. This PRD covers Phase 0 in isolation; Phase 1+ (cookie scoping, fingerprint farbling) live in [wearecooked v5's PRD](https://github.com/hamr0/wearecooked/blob/main/PRD.md).

## Why Phase 0 in wearehere

wearehere is the aggregator — it observes, scores, reports. Today its cookie classification uses (1) third-party domain heuristic and (2) the network-domains.js tracker list. It does *not* classify cookies by their **name**, which is where the richest tracker signal lives (`_ga`, `_fbp`, `IDE`, `MUID`, `__utma`, …).

Phase 0 closes that gap by lifting Cookie AutoDelete's hand-curated tracker-name list — ~7 years of issue-driven curation — into wearehere as a data file consumed by the existing cookie classifier. Pure detection upgrade; matches wearehere's mission.

The same data file is the dependency for [wearecooked v5 phase 1](https://github.com/hamr0/wearecooked/blob/main/PRD.md) (cookie scoper), so this phase unblocks two repos with one extraction.

## What we borrow, exactly

| Source | Files | What we extract | License posture |
|---|---|---|---|
| **Cookie AutoDelete** ([github.com/Cookie-AutoDelete/Cookie-AutoDelete](https://github.com/Cookie-AutoDelete/Cookie-AutoDelete)) | `extension/lib/lists/*` (tracker-name patterns) | ~200 cookie-name patterns classified by category (Analytics, Advertising, Social, Session, …) | GPL-3.0 source. Lists are facts (not copyrightable in US; weak DB right in EU). Lifted with NOTICE attribution, not as derived code. wearehere stays MIT. |
| Cookie AutoDelete (same repo) | Essential-cookie allowlist for top sites | Per-domain "don't touch these" patterns for banking / gov / mail | Same posture |

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

- **Maintenance-mode ≠ Chrome outplayed it.** Cookie AutoDelete is stalled on MV3 port effort and maintainer time, *not* on API death. `chrome.cookies` is fully alive in MV3. So lifting the knowledge is reasonable; the techniques still work.
- **Lift knowledge, not plumbing.** The valuable part of Cookie AutoDelete is the curated lists. The MV2 background-page plumbing is throwaway. Same pattern applied to JShelter for the fingerprint side (relevant to wearecooked v5, not here).
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

1. Pull Cookie AutoDelete's tracker list files from upstream (last stable release tag).
2. Transform into the canonical `cookie-patterns.js` shape (pattern → category, plus essential allowlist by domain).
3. Wire into `background.js` `fetchCookies()` — name lookup, category aggregation in `tabData[tabId].cookies`.
4. Surface in popup and report cookies tab.
5. Ship as wearehere v3.3.0. No new permissions, no new tabs, no new score categories.
6. Pin the same `cookie-patterns.js` snapshot into wearecooked v5 as its phase 1 input.

## Open questions

- **Canonical home of the list.** Recommendation: wearehere. wearecooked vendors. Alternative: a `wearelists` data-only package both consume. Decide before Phase 0 ships; the file path determines the import shape in both downstreams.
- **List update cadence.** Tied to wearehere release cadence (currently roughly monthly). No upstream sync automation in Phase 0.
- **Display polish.** "8 ad-tech" / "3 analytics" / "1 session" is the obvious phrasing. Real wording lives in the Cookies tab UX pass, not this PRD.
