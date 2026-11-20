---
title: Product contract (PRD)
slug: PRD
gloss: "Binding product contract: thesis, architecture, the three capabilities, UX surfaces, known issues, references"
source: docs/archive/PRD.md
---

# Product contract

Binding requirements for wearehere. Rationale and history live in [decisions.md](../wiki/decisions.md); the effectiveness ceiling and threat model live in [findings.md](../wiki/findings.md). Citations are `(docs/archive/PRD.md:start-end)`.

## 1. Thesis and posture

- wearehere is an **honest observer with light intervention**: it tells the user what happens on every site, names every watcher, and acts back in two scoped, visible ways (cookie scoping, fingerprint farbling). Tagline "privacy that acts back"; the act is never silent. (docs/archive/PRD.md:16-16)
- **Everything is local.** No accounts, no cloud, no AI calls; deleting the extension removes every trace. (docs/archive/PRD.md:18-18)
- **Truth-of-observation is preserved.** Scoped/swept cookies and farbled surfaces are labelled in the dashboard so the user sees what was changed. (docs/archive/PRD.md:19-19)
- **Non-goal (decided 2026-05-13): not a request blocker.** No network-layer blocking (`declarativeNetRequest` / `webRequest` block rules), because uBlock Origin already solves it; pair with a blocker. Consequences: no `declarativeNetRequest` permission, no rule-set bundling, minimal store-review surface. (docs/archive/PRD.md:20-20)

## 2. Architecture

- **One MV3 extension.** Chrome is primary. `firefox-extension/` mirrors it byte-for-byte except `background.js` (an `importScripts` guard) and `manifest.json` (MV3 dialect + AMO fields). The npm `wearehere` package exposes the `assess` shape. (docs/archive/PRD.md:26-26)
- The Firefox mirror is a **deliberate final step**, done once after Chrome is hands-on verified; never mirrored or bumped incrementally. (docs/archive/PRD.md:26-26)
- **Shape:** per-tab in-memory observer (`tabData[tabId]`), cross-session persistence in `chrome.storage.local`, the cookie scoper module (`chrome-extension/scoper/`), and the farbler wrappers (MAIN-world `inject.js` plus ISOLATED-world handshake in `detect-watched.js`). (docs/archive/PRD.md:28-28)
- Cookie scoping ships inside wearehere (reversed 2026-05-12 from a separate "wearecooked v5" extension): one install, one storage, no cross-extension messaging. (docs/archive/PRD.md:28-28)

### Permissions

- Requested: `storage`, `alarms`, `cookies`, `webRequest` (observe only), `scripting` (6.0.0: registers `inject.js` dynamically so Trust ID sites can be `excludeMatches`'d), `<all_urls>` host permissions. (docs/archive/PRD.md:30-30)
- Deliberately **not** requested: `webNavigation` (its "Read your browsing history" warning is bad optics and forces a re-grant on update), `declarativeNetRequest` (see section 1), `activeTab` (redundant with `<all_urls>`, dropped pre-AMO). (docs/archive/PRD.md:30-30)
- `webRequest` is not used to block. The 403-triggered relax offer is removed (2026-11-19).
- Never rewrite headers on vendor/anti-bot frames: a DNR Trust-ID frame marker (sentinel `Last-Modified` on sub_frames) broke Stytch magic-link sign-in and was reverted; `declarativeNetRequestWithHostAccess` dropped. `scripting` (registerContentScripts `excludeMatches`) needs store re-review at the next release.

### Registrable-domain keying (eTLD+1)

- Per-site rules (cookie trust, blur overrides) key on the registrable domain. A **curated ~45-entry subset of the Public Suffix List** (`WH_PUBLIC_SUFFIX`) resolves `*.co.uk` / `*.github.io` to three labels. (docs/archive/PRD.md:32-32)
- It **must stay byte-identical across five writer/reader sites**; a mismatch silently drops rules (docs/archive/PRD.md:32-37):
  - `background.js` `harvestEtld1` (defines canonical `self.WH_PUBLIC_SUFFIX`)
  - `scoper/scoper.js` `etld1Of` (reuses `self.WH_PUBLIC_SUFFIX`)
  - `detect-watched.js` `etld1FromHost` (own copy, isolated content-script scope)
  - `popup.js` `etld1FromHost` (own copy)
  - `report.js` add-row `whEtld1()` (own copy)
- The farble **seed is per-origin** (`location.hostname`, not eTLD+1), so default protection is unaffected by keying; only exception scoping is. Old over-broad keys self-heal to defaults; no migration. Full PSL (~10k entries) is deferred. (docs/archive/PRD.md:39-39)

### Storage contract (`chrome.storage.local`)

Scanner / history (docs/archive/PRD.md:44-48):

| Key | Shape |
|---|---|
| `visitHistory` | `[{domain, visitTimestamp, score, trackers:[{company, mechanisms:[]}], sweepImpact, termsScore, blurredSurfaces}]` |
| `windowSnapshots` | `{week, month, allTime}`, for Overview "what changed" diffs |
| `scoreHistory` | `[{timestamp, score}]`, optional; shipped impl reuses visitHistory dots |
| `tosCacheV2` | `{[domain]: {privacy, terms, at}}`; TTL 30d found / 1d miss, cap 500. V1 (old scanner score scale) is deleted at SW start |

Cookie scoper (docs/archive/PRD.md:50-54):

| Key | Shape |
|---|---|
| `cookieScopeHistory` | `[{timestamp, trigger, scanned, rewrote, demoted}]` |
| `cookieScopeTrust` | `{[etld1]: {duration:'30d'\|'90d', addedAt}}` |
| `cookieScopeSettings` | `{sweepPeriod:'15min'\|'hourly'\|'4hr'\|'12hr'}` |
| `cookieScopeCounters` | `{tightened, killed, sitesWatched, lastSweep, bySite:{}}` |

Fingerprint farbler (docs/archive/PRD.md:56-66):

| Key | Shape / meaning |
|---|---|
| `farblerSecret` | 64-byte HMAC key, generated once by SW `onInstalled` |
| `farblerRotationSalt` | SW-managed salt, regenerates on a 7-day window |
| `farblerSettings` | `{[etld1]: {mode:'off'\|'stable', auto?:bool}}`; exceptions, absent = rotation default |
| `defaultBlurMode` | `'off'\|'stable'\|'rotation'`; global default (rotation) |
| `farblerAllowlist` | `{[etld1]: {addedAt}}`; force pass-through |
| `farblerCounters` | `{byFamily:{}, ...}`; surfaces-blurred telemetry |
| `farblerBlurredBySite` | `{[etld1]: count}` |
| `farblerHistory` | capped blur-event log |
| `farbleDisableFamilies` | `['canvas'\|'webgl'\|'audio'\|'fonts'\|'screennav']`; per-family kill (diagnostic) |

- **Superseded:** the original `farblerStats` and per-tab nonces in `chrome.storage.session` (`farblerTabNonces`) are gone; the `per-tab` seed mode was dropped and rotation uses the time-keyed `farblerRotationSalt`. (docs/archive/PRD.md:69-69)

## 3. Capability A: Privacy scanner (detection)

- The aggregator: observe, classify, score, report. It ships a 10-category scanner; curated data sharpens classification. (docs/archive/PRD.md:121-121)
- Borrowed data, exactly (docs/archive/PRD.md:125-128):
  - **Open Cookie Database** in `cookie-database.js`: 1,989 exact + 260 prefix cookie names across {Analytics, Marketing, Functional, Necessary, Security, Personalization}, 354 vendors. Apache-2.0, lifted as factual data, NOTICE attribution, SHA pinned.
  - **JShelter web-extension** in `fingerprint-surfaces.js`: 149 Web API surfaces (74 props + 75 fns) in 12 fingerprint groups. GPL-3.0 source; only the surface *enumeration* is lifted (with NOTICE), **no JShelter source reused**; `inject.js` wrappers are original. wearehere stays Apache-2.0.
- **Scope discipline: lists are facts, code is code.** Lifting a list with attribution does not infect Apache-2.0; lifting source verbatim would require a GPL-3 sub-package. (docs/archive/PRD.md:130-130)
- Also live: the network-domain tracker registry (`network-domains.js`, `classifyNetworkDomain()`) and the terms scanner (`detect-tosed.js` over `scanText`/`getPageType`/`findPolicyLinks`). Detection feeds the score and "who's watching" attribution. (docs/archive/PRD.md:132-132)
- **Source correction (2026-05-12):** Cookie AutoDelete bundles no curated list, so the Open Cookie Database was used instead. (docs/archive/PRD.md:134-134)
- **Superseded:** the 10-category cookie label set in the old Cookies tab was dropped in favour of OCD-vendor + scoper-action breakdown (see 7.2); the OCD data file remains the input the scoper reads. (docs/archive/PRD.md:136-136)

## 4. Capability B: Cookie scoper

Background cleaner that rewrites tracker-cookie lifetimes. Transplanted from the `hamr0/wearecooked` `port-kit` branch into `chrome-extension/scoper/`, rewired from cross-extension `sendMessage` to internal `chrome.storage.local`. (docs/archive/PRD.md:142-142)

- **7-day cap, locked:** first-party cookies capped to 7d expiry; **not user-tunable**. (docs/archive/PRD.md:144-144)
- **Third-party demotion:** 3p tracker cookies demoted to **session** (killed on *browser* close). (docs/archive/PRD.md:145-145)
- **Trust list:** sites the user "lives in" cap at **30d / 90d**, user-removed, no auto-expiry. No cookie "off" option; untrusted sites 7d; trackers demoted to session. (docs/archive/PRD.md:146-146)
- **Skipped everywhere (default rule, 2026-11-19):** partitioned cookies (`partitionKey` / `firstPartyDomain`) and challenge-host cookies (`WH_CHALLENGE_EXCLUDES`), in sweep and `onChanged`. Cause: `cookies.set` without the partition key duplicated Cloudflare `cf_clearance` and Turnstile failed ("Couldn't verify your browser"). In Firefox (Total Cookie Protection) this means no third-party cookie is trimmed.
- **Sweep alarm:** periodic background sweep; period `15min / hourly (default) / 4hr / 12hr`. (docs/archive/PRD.md:147-147)
- **Spec correction (known limit):** shipped behaviour is session-on-browser-close, not "kill on tab close"; UI copy reads "demoted to session." Per-tab attribution is a large effort and not the common mental model. See section 8 for the `partitionKey` (CHIPS) gap. (docs/archive/PRD.md:149-149)

## 5. Capability C: Fingerprint farbler

Promotes the existing notify-only `inject.js` wrappers from "log" to "lie," gated by a per-origin policy, built on existing inject.js plumbing. (docs/archive/PRD.md:155-155)

### Locked decisions (docs/archive/PRD.md:159-169)

| # | Decision | Choice |
|---|---|---|
| 1 | Wrappers in scope | 8 existing notify-only + WebGL `getParameter`, `deviceMemory`, `screen.*`, `performance.now()` (Tier A); canvas + audio + fonts (Tier B) |
| 2 | Per-origin behaviour | off / rotation / stable (see seed-scope revision) |
| 3 | Cookie-trust to stable | **Automatic**: site in `cookieScopeTrust` gets stable farble, no second toggle ("I live here" = "consistent fake identity here") |
| 4 | Same fake across logged-in sites? | **No, per-origin only**; seed = `HMAC(secret, origin)`, because a cross-site uniform fake re-enables tracker merge |
| 7 | Global default | **ON** (`defaultBlurMode: 'rotation'`); cookie trust acts as auto-pass-through for logged-in sites |
| 8 | Manual force-pass-through allowlist | **Yes**, separate from cookie trust (power-user escape hatch for anti-bot sites) |
| 9 | "Force farble" override on trusted sites | **Skip** |
| 10 | Tier B algorithm source | **JShelter spec only**, Brave spec as cross-reference; no source lift |
| 11 | Seed secret rotation | **Secret never rotates** after first generation (rotation would break stable fake on trusted sites) |

### Seed-scope model (superseded decisions #5/#6, 2026-05-20)

- The shipped `per-tab` mode was an **unwired stub** (hardcoded placeholder nonce), so `per-tab` and `stable` were both persistent-per-origin. A permanent per-origin seed is itself a durable pseudonymous fingerprint, so the model was reframed around cross-site **and** longitudinal unlinkability. (docs/archive/PRD.md:171-171)
- **Shipped model: `off` / `rotation` (default) / `stable`.** (docs/archive/PRD.md:173-173)
- **rotation** folds an SW-managed salt into the label (`rotation|<salt>|<origin>`) that regenerates on a **7-day window** (`bootstrapFarbleSalt`, single-writer in the SW; content script fails safe to `off` if absent). Stable within a window, unlinkable across windows. **Time-keyed, not session-keyed**, since browsers rarely close. (docs/archive/PRD.md:174-174)
- **stable** keeps the persistent-per-origin seed as a per-site pin for frequently-logged-in sites; strictly better than `off`, which leaks the real fingerprint. (docs/archive/PRD.md:175-175)
- `inject.js` `farbleState()` whitelists `stable|rotation`; legacy `per-tab` settings fold to `rotation`. Per-site rules cycle blur `rotation → off → stable`; cycling to `rotation` removes the override. (docs/archive/PRD.md:176-176)

### Call-time decision flow (docs/archive/PRD.md:180-189)

1. Page calls a wrapped surface (e.g. `navigator.hardwareConcurrency`); the wrapper fires `notify()` (telemetry, always).
2. The wrapper reads `data-wh-farble-state` + `data-wh-farble-seed` on `<html>`, written by `detect-watched.js` (ISOLATED, `document_start`) after reading storage.
3. `off` returns the real value; `stable` fakes from `HMAC(secret, origin)`; `rotation` fakes from `HMAC(secret, "rotation|" + salt + "|" + origin)`.

- The secret is generated once by the SW (`onInstalled`/`onStartup`/top-level, idempotent), so the content script never bootstraps it and its chain is one `storage.local.get` + HMAC (wins the race against early probes). The DOM-attribute handshake was validated in POC (2026-05-18). The seed module lives **inline in `detect-watched.js`**. (docs/archive/PRD.md:191-191)

### Surfaces shipped

- **Tier A (constants):** `navigator.languages` to `["en-US","en"]`, `deviceMemory` 8, `hardwareConcurrency` 4, `screen.{width,height}` snapped to nearest of {1366x768, 1920x1080, 2560x1440, 3840x2160}, `screen.{colorDepth,pixelDepth}` 24, `performance.now()` floored to 100us, WebGL `UNMASKED_RENDERER/VENDOR` fixed strings. `navigator.platform` is **notify-only (reverted)**. (docs/archive/PRD.md:195-195)
- **Tier B (seeded):** canvas (`toDataURL`/`toBlob`/`getImageData`/`readPixels` WebGL1+2/`createImageBitmap`, via generalized `farbleAnyCanvas` over `drawImage`); audio (`AudioBuffer.getChannelData` + `AnalyserNode.*`); fonts (`measureText` to one of 10 Win32 fonts at canonical widths). (docs/archive/PRD.md:196-196)
  - Perturbation = 100 pixels at **xorshift32 seed-derived positions** (anti-averaging).
  - Size gates: skip < 1024 px (32x32 font probes) and > 1024x1024 px (legit exports).
  - **Receiver-guard** (`Object.prototype.toString` brand-true) on every prototype-method wrapper; **WeakMap dedup** on `getChannelData` so additive noise does not accumulate.
- **Sub-frame coverage:** `match_origin_as_fallback: true` on `inject.js` + `detect-watched.js` only. (docs/archive/PRD.md:197-197)
- **Per-family kill (`famState` / `farbleDisableFamilies`):** every wrapper routes through `famState(fam)`; built as a diagnostic and kept as a diagnostic. (docs/archive/PRD.md:198-198)

### Escape hatch: Trust ID (relax offer removed 2026-11-19)

- **Trust ID = blur completely off** for that site: top frame, same-site frames, blank/srcdoc frames. Registered via `excludeMatches` so no wrappers install. Challenge-provider frames are never wrapped.
- **Accepted gap:** third-party frames inside a trusted site stay blurred. A frame-marker approach was tried and reverted (see section 2 Permissions).
- `stable` still blurs (fixed seed); it is a per-site pin, **not** an escape hatch.
- The rage-reload / 403 relax offer (reload streak, banner, popup hint, `farbleReloadOffer`, `wh-relax-site`) is **removed**; one-time storage cleanup. Reason: the reload heuristic never fired in Firefox 160 and the user base is small. Trust ID + trusted cookies are the only whitelist.
- **Login guidance:** device-fingerprint auth (e.g. Stytch magic links, typesafe.ai) needs Trust ID on the site you log into; trusting the provider is not needed.

## 6. UX surfaces

### 6.1 Popup: one site, right now

- Three blocks plus a Privacy guard card (decided 2026-05-12; farbling folded into the guard card 2026-05-19), scanned for *who's watching, what they're learning, where it goes*. (docs/archive/PRD.md:210-210)
- **Score line stays** (e.g. `40 MODERATE`): the number is the signature for returning users, the plain-English verdict serves non-tech users. (docs/archive/PRD.md:232-232)
- **Mechanism vocabulary** (same across popup and dashboard): **cookies** (OCD name-matched), **pixels** (3p requests to tracker domains, incl. iframes/scripts), **device ID** (fingerprint-surface reads), **typing** (input-field watchers), **clicks** (outbound link tagging). A company appears under *Who's watching* if any fire; chips list the deduped union actually detected, no padding. (docs/archive/PRD.md:233-233)
- **Who's-watching count rules:** 0 shows `No trackers detected ✓` (chip line hidden); 1 `Google`; 2 `Google · Meta`; 3+ `Google · Meta  +N more`. Ranked by mechanism-count. (docs/archive/PRD.md:234-234)
- **Footer chips** collapse Selling / Terms / Pressure to one strip (`✓ Not sold` / `⚠ Sold to brokers`, `✓ Terms OK` / `⚠ Terms hostile`, pressure badges). **Shipped deviation:** every chip always shows rather than collapsing to `✓ All clear`. (docs/archive/PRD.md:235-235)
- **Privacy guard card** renders only fired mechanisms (`No protection active ✓` if neither). Cookies line states cap + per-site `trimmed`/`killed` (zero counts omitted); blur line states `blurred · N surfaces` (or `stable seed` / `ID passing through`). (docs/archive/PRD.md:236-236)
- Buttons name their target: `[ trust cookies 30d ]` / `[ trust ID ]`, becoming `[ untrust … ]` when active, with the active state in **caution amber**. `trust ID` sets the origin's blur mode to `off` (binary; `stable` is dashboard-only). `Sweep now` and `trust 90d` are dashboard-only. (docs/archive/PRD.md:236-236)
- The popup is **glance + one action**; raw counts, splits, telemetry, trust-list management and per-mechanism breakdowns live in the dashboard. (docs/archive/PRD.md:238-238)

### 6.2 Dashboard: three tabs

Cut from 6 to 3 (decided 2026-05-12): **Overview**, **Watchers**, **Privacy guard**. Removed: `Cookies` (into Privacy guard), `Network` (into Watchers `pixels`), `Terms` (into Watchers 4th block), `Network Map` (dropped; rarely actionable). (docs/archive/PRD.md:242-242)

**Overview: the time-based story** (the only trend/"what changed" surface; every other tab is current-state). (docs/archive/PRD.md:244-244)
- Hero strip (lifetime): `sites visited · avg score · unique watchers · cookies trimmed · surfaces blurred`; the window selector (day/week/month/all) drives the lists and events below it. The Watchers tab hero is `sites visited · hidden contacts · unique watchers · trimmed · blurred` (windowed; replaced avg-per-visit in 6.0.0). Watchers are counted and listed by parent company (Google Ads + Google Analytics = Google). (docs/archive/PRD.md:245-245)
- **What changed:** per-window diff event log (new/gone watcher, reach grew/shrank >=10pts, cookies grew >=+10, score improved >=5pts, sweep impact, new site), ranked by magnitude x visit-frequency; first-visit events collapse to one "N new sites" summary. (docs/archive/PRD.md:246-246)
- **Browsing exposure:** sites bucketed clean (`<=15`) / moderate (`16–40`) / hostile (`41+`) by avg score (aligned with the popup verdict, 6.0.0); score-trend chart is nice-to-have. (docs/archive/PRD.md:247-247)
- **Impact line:** green callout "this week: wearehere shortened N cookies and demoted M trackers to session-only so they can't recognise you tomorrow"; hidden when both counts are 0. (docs/archive/PRD.md:248-248)

**Watchers: who follows you across the web** (per-site reality; the popup covers "who's on this site"). (docs/archive/PRD.md:250-250)
- Hero: `sites visited · hidden contacts · unique watchers · 1 visit ≈ N hidden contacts` + window selector. (docs/archive/PRD.md:251-251)
- **Who follows you:** companies ranked by reach % (visits seen / total), with a plain `via cookies · pixels · clicks · device-id` line; nonzero **Trimmed** / **Blurred** counts render in warn-yellow. (docs/archive/PRD.md:252-252)
- **Recent visits:** per-site tag-along count, top watchers, and a **Terms** column (`18 ⚠` / `67 ✓`); `[ Clear history ]` resets the visit log only. (docs/archive/PRD.md:253-253)
- **Terms block:** per-site clause breakdown with site selector; defaults to most-exposed site / current tab / placeholder. (docs/archive/PRD.md:254-254)

**Privacy guard: impact, population, management, audit** (renamed from `Cookie scoper`). Both mechanisms stay visually parallel. (docs/archive/PRD.md:256-256)
- **Lifetime hero:** `trimmed · blurred · sweeps run · last active`. (docs/archive/PRD.md:257-257)
- **Cookies in your browser:** Coverage (capped 1p·7d / tracker demoted-to-session / trusted), By expiry (session / <7d / 7–30 / 30–90 / 90+), Top owners, `[ Inspect all N ▾ ]`. (docs/archive/PRD.md:258-258)
- **Surfaces blurred:** Coverage by family (canvas / audio / fonts / nav-screen / WebGL constants, from `farblerCounters.byFamily`), By mode (rotation / stable / off), Top sites (`farblerBlurredBySite`). (docs/archive/PRD.md:259-259)
- **Per-site rules** (merged 2026-05-20): one table keyed by eTLD+1 holding a site's cookie and blur exception on one row. (docs/archive/PRD.md:260-260)
  - Add row `[domain] (•) cookies ( ) blur [add]`: cookies-add trusts 30d; blur-add sets `off`; neither touches the other axis.
  - Cells cycle independently: cookies `7d → 30d → 90d → 7d`; blur `rotation → off → stable → rotation`. `[✕]` clears both axes; cycling a cell to default removes only that axis.
  - Storage stays split (`cookieScopeTrust` + `farblerSettings`); the table is the live union and syncs with the popup's trust ID.
  - Rows sort **newest-added first**, anchored by the newer of the row's blur-override and cookie-trust `addedAt`.
- **Settings:** Cookie sweep period (default hourly) + **Default blur** radio (off / stable per origin / **rotation**, default), each with a plain-language explainer. `farbleDevMode` retired (blur ships ON). The 7d cap is not exposed. (docs/archive/PRD.md:261-261)
- **Recent activity:** unified sweeps + blur log (`cookieScopeHistory` + capped `farblerHistory`); collapsed by default. (docs/archive/PRD.md:262-262)
- **Dropped:** the 10-category classification, `TRACKING/ADS` stat card and `Clean Cookies` CTA; `Sweep now` is the one verb. Earlier "Cookie scoper" 5-block and separate Trusted sites / Blur overrides tables are superseded. (docs/archive/PRD.md:264-264)

## 7. Known limits (summary)

See section 8 for the full table; the headline gaps are Worker/OffscreenCanvas fingerprinting, SPA `pushState` counted as one visit, and the curated-not-full PSL. (docs/archive/PRD.md:366-373)

## 8. Known issues and deferred work (docs/archive/PRD.md:364-388)

| Item | Severity | Where | Notes |
|---|---|---|---|
| `measureText` all-zero bounding boxes | correctness bug | `inject.js` `fakeTextMetrics` | Return non-zero metrics (ascent ~0.8x size, descent ~0.2x size), keep canonical width; layout code dividing by ascent can break. |
| Full PSL vs curated ~45-entry subset | deferred | the five eTLD+1 sites | ~10k list needs an update story + key migration. |
| Tab-close 3p deletion not implemented | spec correction | scoper | No `tabs.onRemoved` handler; "demoted to session" matches actual behaviour. |
| `partitionKey` (CHIPS) not preserved on rewrite | resolved 2026-11-19 | scoper | Partitioned and challenge-host cookies are now skipped (9d47c5a). |
| Worker / OffscreenCanvas fingerprinting | acknowledged gap | farbler | Content-script wrappers do not reach Worker globals; rare in mainstream FP libs. |
| `persistPendingVisit` writes session-storage per `detection` | Important | `background.js` | Heavy SPAs may approach per-minute write cap; one-line debounce deferred until observed. |
| SPA `pushState` yields one visit record | Important | `tabs.onUpdated` | Fix needs `webNavigation` (extra AMO ask); accepted trade-off. |
| `scoper:ensureAlarm` may reset next-fire on SW wake | Important | scoper | Mirror the `chrome.alarms.get` pre-check `SNAPSHOT_ALARM` uses. |
| `buildSetDetails` null on `sameSite=no_restriction && !Secure` counted `failed` | Important | scoper | Phantom failures in telemetry; cosmetic. |
| Popup trust-input validates URL shape weakly | Important | `popup.js` | Accepts `localhost.com`, IPs, `..invalid..`; self-inflicted, not security. |
| Footer-chip expand-on-click for ⚠ chips | low | `popup.js/html` | Spec: ⚠ chip expands to a full card; today plain text. |
| What-changed `[ Show all (N) ]` expander | low | `report.js renderWhatChanged` | Caps at 20, no expander; spec is cap 8 + expander. |
| What-changed ranking by magnitude x visit-frequency | low | `report.js diffAggregates` | Today in detection order; needs per-site visit-count from snapshot. |
| Score-trend prior-window comparison footer | low | `report.js renderScoreTrend` | Shows "avg N · range X→Y", not "this month vs last month". |
| "Inspect all N cookies" expander | low | `report.js` Privacy guard | Collapsed per-cookie table (vendor · category · expiry · domain · scoper-action). |
| Last-two-labels eTLD+1 in non-rule code | Minor | `network-domains.js:560`, `visits.js:44`, `report.js` | Company/visit/display grouping, not rule keys; deliberately left (rule keys are PSL-aware per section 2). |
| No CSP declared in manifest | Minor | manifest | MV3 default CSP is strict; optional defense-in-depth. |
| Stack-walk wrap set in `inject.js` minimal | Minor | `inject.js` | No `getImageData`/`toBlob`/`OffscreenCanvas`/WebGL2 stack-walk surfaces; tests for the locked set do not exist yet. |
| `compactVisit` brokerCount fallback | Minor | `report.js` | Can show "5 brokers" with zero names; one-line fix. |
| Test-coverage gaps | Minor | suite | `safeBgFetch` redirect chain, `removedTabs` LRU eviction, `snapshotAndEvict` recovery, `cookieScopeCounters.bySite`, `buildSetDetails` `__Host-` violations, message-handler cross-check; add post-FF-mirror. |
| Report-only scanners run after page settle | shipped 6.0.0 (0ec8d09) | `settle.js`, `detect-*.js` | Run after load + ~2 s quiet (max wait 5 s), idle work sliced <~16 ms, pending work flushed on tab hide/leave and popup open. Visits under ~2 s may go uncounted (accepted). Before: detect-played 0.3-1 s CPU/page on ad-heavy sites, long tasks 60-920 ms; step-1 build removed >50 ms extension tasks in Chromium, Fox News load-window CPU 214 to 67 ms (FF). |
| Watchers per-company Trimmed/Blurred mostly 0 | fixed 6.0.0 (df8a037, 69b7395, 8b5c571) | `report.js`, `background.js` | Cookie-to-company map is learned only from on-page tracker elements (4 domains in user data); sub-brands (Google Ads/Analytics) never match "Google"; blur from first-party/CDN scripts dropped. Fix: seed map from built-in tracker list, match by registrable domain, credit sub-brands to parent, one "everything else" row for unattributed. |
| Unpartitioned `__cf_bm` with extension loaded | open, unexplained | scoper/inject | Appears on typesafe.ai even with scoper disabled; absent no-ext. Not the login cause. |
| `data-wh-farble-seed` readable by page on untrusted sites | open, redesign pending | `detect-watched.js` | Attribute handshake exposes the seed. |
| Add the `vm` stress harness to the repo | offered | `/tmp/wh-stress/stress.js` | 47/47 over real extracted source; uncommitted; would be a regression guard. |
| Phase 6 cleanup: dead CSS / retired-tab images | pending | repo | Remove dead CSS, retired-tab PNGs (`baked/cooked/played/linked/silent/tosed/watched/leaking.png`), unreachable manifest permissions; single commit. |

## 9. References

- **Build sequence and dependency graph:** `docs/logs/01-product/PLAN.md` (what is here; how/in-what-order is there). Chrome first, Firefox mirror last. (docs/archive/PRD.md:394-394)
- **Release:** next version 6.0.0, bump at release only. Store v5.0.0 still has the cookie bug until then.
- **Changelog:** `CHANGELOG.md` `## [5.0.0]`. (docs/archive/PRD.md:395-395)
- JShelter wrappers list vendored at `chrome-extension/fingerprint-surfaces.js` (149 surfaces, 12 categories); Open Cookie Database vendored at `chrome-extension/cookie-database.js`. (docs/archive/PRD.md:396-397)
- POC validation transcript, 2026-05-18: `data-wh-farble="on"` gives `navigator.hardwareConcurrency === 4`. (docs/archive/PRD.md:398-398)
- Shared rules: `.claude/memory/AGENT_RULES.md`; attribution for borrowed lists: `NOTICE`. (docs/archive/PRD.md:399-400)
- Rationale and history: [decisions.md](../wiki/decisions.md). Effectiveness ceiling and threat model: [findings.md](../wiki/findings.md).
