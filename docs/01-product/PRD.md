# wearehere — Product Requirements (consolidated)

> **Status:** one product, shipping to Chrome Web Store / Firefox AMO / npm. v5.0.0 (unreleased) is the current line. wearehere is three capabilities under one install:
> 1. **Privacy scanner** — observe and score who's watching you (the original Phase 0 work).
> 2. **Cookie scoper** — tighten tracker cookies so they can't recognise you tomorrow (formerly the separate "wearecooked v5"; now an internal module).
> 3. **Fingerprint farbler** — substitute fake values for fingerprint surfaces, per-origin (Phase 2).
>
> This document merges the original Phase 0 PRD and the Phase 2 farbler PRD into one. **Current design** is authoritative (§1–§7); **all decisions and findings are preserved** in the decision log (§8); **known issues / deferred work** are consolidated in §9. Where an old decision was later reversed (e.g. detection-only → intervention; `per-tab` farble → `rotation`), the superseding entry is marked and the original is kept for history.
>
> **Mandatory rules:** all implementation work follows `.claude/memory/AGENT_RULES.md` — POC first, incremental modules, vanilla→stdlib→external dependency hierarchy, surgical changes, open-source only, mobile-responsive UI verified in DevTools before claiming UI tasks done. Never ship a POC — graduate, design, then build with tests. Build/order detail lives in [PLAN.md](./PLAN.md).

---

## 1. Thesis & posture

wearehere is an **honest observer with light intervention.** It tells you what's happening on every site, names every watcher, and acts back in two scoped, visible ways (cookie scoping + fingerprint farbling). Tagline: **"privacy that acts back"** — the *act* is cookie scoping + farbling + transparency, never silent.

- **Everything is local.** No accounts, no cloud, no AI calls. We don't know you installed it. Delete the extension and every trace goes with it.
- **Truth-of-observation is preserved even though we now intervene.** Scoped/swept cookies and farbled surfaces are explicitly labelled in the dashboard, so the user always sees what we changed.
- **Not a request blocker (non-goal, decided 2026-05-13).** wearehere does **not** block tracker requests at the network layer (`declarativeNetRequest` / `webRequest` block rules). uBlock Origin already solves request-blocking with curated lists and serious filter-rule engineering; re-implementing it would be "another blocker, less mature." Posture stays **honest observer + light intervention**; pair wearehere with uBlock (or any blocker) for actual request prevention — complementary, not competitive. Consequences: no `declarativeNetRequest` permission, no rule-set bundling, minimal store-review surface.

---

## 2. Architecture

**One MV3 extension.** Chrome is primary; `firefox-extension/` mirrors it byte-for-byte except `background.js` (an `importScripts` guard) and `manifest.json` (MV3 dialect + AMO fields). The npm `wearehere` package exposes the `assess` shape. The Firefox mirror is a **deliberate final step** done once after Chrome is hands-on verified — never mirrored/bumped incrementally.

**Shape:** a per-tab in-memory observer (`tabData[tabId]`) plus cross-session persistence in `chrome.storage.local`, plus the cookie scoper module (`chrome-extension/scoper/`), plus the farbler wrappers (MAIN-world `inject.js` + ISOLATED-world handshake in `detect-watched.js`). Cookie scoping was originally routed to a separate "wearecooked v5" extension; **that was reversed (2026-05-12)** — it ships inside wearehere. One install, one storage, no cross-extension messaging.

**Permissions:** `storage`, `alarms`, `cookies`, `<all_urls>` host permissions. Deliberately **not** requested: `webNavigation` (its "Read your browsing history" install warning is bad optics for a privacy tool, and forces a re-grant on update), `declarativeNetRequest` (see §1), `activeTab` (redundant with `<all_urls>`, dropped pre-AMO). `webRequest.onCompleted` is used **observe-only** (main-frame 403 → relax offer), never to block.

**Registrable-domain keying (eTLD+1).** Per-site rules (cookie trust, blur overrides, relax offers) key on the registrable domain. A **curated ~45-entry subset of the Public Suffix List** (`WH_PUBLIC_SUFFIX`) lets `*.co.uk` / `*.github.io` resolve to three labels instead of two. It **must stay byte-identical across five writer/reader sites** — a mismatch silently drops rules:
- `background.js` `harvestEtld1` (defines canonical `self.WH_PUBLIC_SUFFIX`)
- `scoper/scoper.js` `etld1Of` (reuses `self.WH_PUBLIC_SUFFIX`)
- `detect-watched.js` `etld1FromHost` (own copy — isolated content-script scope)
- `popup.js` `etld1FromHost` (own copy)
- `report.js` add-row `whEtld1()` (own copy)

The farble **seed is per-origin** (`location.hostname`, not eTLD+1), so default protection was never affected by the keying — only exception scoping. Old over-broad keys self-heal to defaults; no migration. Full PSL (~10k entries) deferred.

### Consolidated storage contract (`chrome.storage.local`)

```js
// --- scanner / history ---
visitHistory:    [{domain, visitTimestamp, score, trackers:[{company, mechanisms:[]}], sweepImpact, termsScore, blurredSurfaces}]
windowSnapshots: {week, month, allTime}        // Overview "what changed" diffs
scoreHistory:    [{timestamp, score}]          // (optional; shipped impl reuses visitHistory dots)
tosCacheV1:      { [domain]: {privacy, terms, at} }  // ToS scan cache, TTL 30d found / 1d miss, cap 500

// --- cookie scoper ---
cookieScopeHistory:  [{timestamp, trigger, scanned, rewrote, demoted}]
cookieScopeTrust:    { [etld1]: {duration:'30d'|'90d', addedAt} }
cookieScopeSettings: {sweepPeriod:'15min'|'hourly'|'4hr'|'12hr'}
cookieScopeCounters: {tightened, killed, sitesWatched, lastSweep, bySite:{}}

// --- fingerprint farbler ---
farblerSecret:        "<64-byte HMAC key, generated once by SW onInstalled>"
farblerRotationSalt:  "<SW-managed salt, regenerates on a 7-day window>"
farblerSettings:      { [etld1]: {mode:'off'|'stable', auto?:bool} }  // exceptions; absent = rotation default
defaultBlurMode:      'off' | 'stable' | 'rotation'   // global default (rotation)
farblerAllowlist:     { [etld1]: {addedAt} }          // force pass-through
farblerCounters:      { byFamily:{}, ... }            // surfaces blurred telemetry
farblerBlurredBySite: { [etld1]: count }
farblerHistory:       [ ... ]                         // capped blur-event log
farbleReloadOffer:    { [etld1]: {at} }               // rage-reload relax offer
farbleDisableFamilies:[ 'canvas'|'webgl'|'audio'|'fonts'|'screennav' ]  // per-family kill (diagnostic + per-site relax foundation)
```

> **Superseded:** the original farbler storage contract used `farblerStats` and per-tab nonces in `chrome.storage.session` (`farblerTabNonces`). The `per-tab` seed mode was dropped (see §6 / §8 seed-scope finding), so session-scoped nonces are gone; rotation uses the time-keyed `farblerRotationSalt` instead.

---

## 3. What we can and can't do (honest ceiling)

### 3a. Cookie classification limits

- **Can't beat opaque tracker IDs.** Random/hashed names (`session_<uuid>`, vendor obfuscation) escape name matching. We catch the long tail of well-known patterns, not adversarial naming.
- **Can't catch first-party-renamed trackers.** If a site proxies Google Analytics and rewrites the cookie to `_session_id`, the list won't flag it. (CNAME-cloak detection is out of scope.)
- **Can't classify session cookies meaningfully.** Most are first-party auth, indistinguishable by name — marked "session/auth."
- **Won't do cross-browser ID linkage.** Detecting that `_ga` on site A == site B requires parsing cookie *values*; out of threat model.

### 3b. Fingerprint farbling — feasible tiers and the ceiling

**Feasible from an extension:**

| Tier | Surfaces | Effort |
|---|---|---|
| **A — Constants** | `WebGL.getParameter` (UNMASKED_RENDERER/VENDOR), `navigator.hardwareConcurrency`→4, `deviceMemory`→8, `languages`→`['en-US','en']`, `screen.*` coarse buckets, `performance.now()`→100µs precision | ~3-5 lines/surface, pure JS |
| **B — Seeded farbling** | `Canvas.toDataURL`/`getImageData`/`toBlob`/`readPixels`/`createImageBitmap` (low-bit pixel noise), `AudioBuffer.getChannelData` + `AnalyserNode.*` (low-amplitude noise), font enumeration cap via `measureText` | JShelter algorithm pattern (spec only, no source lift); HMAC-derived per-origin seed; ~300-500 lines |

**Not feasible from an extension (acknowledged ceiling):**

| Limit | Why | Who beats it |
|---|---|---|
| Inline `<script>` before `document_start` | MAIN-world content scripts fire at the earliest extension-visible moment; ~2-5% of sites probe earlier | Brave (renderer-level C++) |
| TLS JA3/JA4, HTTP/2 settings-frame order | Below JS surface, set by OS network stack | OS-level changes |
| Real IP + ASN | Network layer | VPN/Tor |
| SVG-glyph bounding-box font enumeration | A determined fingerprinter renders into SVG; we blunt `measureText`, can't eliminate | Nobody fully |
| "User runs anti-fingerprint extension" meta-signal | Honest framing required | Brave (default for all its users) |
| **Sandboxed iframes without `allow-scripts`** | Chrome blocks ALL script execution (incl. content scripts) as a security boundary; `match_origin_as_fallback` resolves URL-match but cannot override the sandbox attribute. Browserleaks-style adversarial harnesses use exactly this. | Brave / Firefox RFP (renderer-level, below the sandbox) |
| **OS-identity via UA client hints / UA string / Worker scope** | `navigator.userAgentData.platform`, `navigator.userAgent`, Worker-global `navigator.*` all bypass main-thread `Object.defineProperty` wrappers. Spoofing only the main thread creates a *cross-check detection signal* (see `navigator.platform` revert, §8). | Brave / Firefox RFP |
| **Commercial aggregate bot-detection (Akamai / PerimeterX / DataDome)** | Probes many surfaces and blocks on *any* detected tampering; no single wrapper fix (Nike/Akamai finding, §8). | Brave (Shields-down per site) |
| Worker / OffscreenCanvas fingerprinting | Workers have their own globalThis; content-script wrappers don't reach them. Rare in mainstream FP libs (they query main-thread). | Brave / Firefox RFP |

**Realistic effectiveness ceiling: ~95-98%.** We raise the cost of identification; we don't eliminate it. **Randomization, not uniformity** — the Safari/Firefox-RFP/Tor "everyone looks identical" model isn't achievable from an extension (we can't convincingly shrink real GPU/canvas entropy from JS without huge breakage and detectable lies). Randomization is the feasible lever at our layer.

**Threat-model honesty.** Farbling targets the **commodity surveillance economy** (FingerprintJS-class libraries that hash-and-join, no spoof-detection) — there it reliably denies the cross-site/longitudinal join key. Against determined adversaries (bank fraud, Akamai-class anti-bot) it's detectable and routed around via un-farbled signals (IP, login, network layer); those aren't the threat model and get the `off`/relax escape hatch.

### 3c. The differentiator

Coverage parity with Brave/Firefox-RFP/JShelter is cheap — no moat there. What nobody else packages:
- **Per-origin three-state model** (rotation / stable / pass-through) coupled to the cookie scoper's trust list — same UX vocabulary, no new learned concepts.
- **Auto-pickup from cookie trust:** a site you marked "I live here" for cookies automatically gets stable farbling. Zero new UI for the common case.
- **Visibility:** per-site "N probes farbled" counters in popup + dashboard, same affordances as the scoper's tightened/killed counters.
- **Default ON**, with the cookie trust list as the auto-allowlist for logged-in sites.

---

## 4. Capability A — Privacy scanner (detection)

The aggregator: observe, classify, score, report. wearehere ships a 10-category scanner; the curated data below sharpens classification.

### What we borrow, exactly

| Source | File | Extracted | License posture |
|---|---|---|---|
| **Open Cookie Database** ([jkwakman/Open-Cookie-Database](https://github.com/jkwakman/Open-Cookie-Database)) | `cookie-database.js` | 1,989 exact + 260 prefix cookie names × {Analytics, Marketing, Functional, Necessary, Security, Personalization} across 354 vendors | Apache-2.0 (matches wearehere). Lifted as factual data, NOTICE attribution, SHA pinned. |
| **JShelter web-extension** ([patrik-dekys/JShelter-webextension](https://github.com/patrik-dekys/JShelter-webextension)) | `fingerprint-surfaces.js` | 149 Web API surfaces (74 props + 75 fns) in 12 fingerprint groups | GPL-3.0 source. Surface *enumeration* is factual data, lifted with NOTICE; **no JShelter source reused** — wrapper implementations in `inject.js` are original. wearehere stays Apache-2.0. |

**Scope discipline: lists are facts, code is code.** GPL-3 source doesn't infect Apache-2.0 consumers when we lift a *list* with attribution. Lifting source verbatim would require a GPL-3 sub-package.

Also live: the network-domain tracker registry (`network-domains.js`, `classifyNetworkDomain()`) and the terms scanner (`detect-tosed.js` over `scanText`/`getPageType`/`findPolicyLinks`). Detection feeds the score and the "who's watching" attribution.

> **Source correction (2026-05-12).** The original draft named *Cookie AutoDelete* as the cookie-name source; investigation showed CAD bundles no curated list (it's a user-expression framework). Switched to the Open Cookie Database — same shape, better data, license-compatible. "Verify the prior art before committing the integration" earned its keep.
>
> **Superseded scope note.** Phase 0 was framed as *detection-only* and the cookie name-match was originally surfaced as a **10-category** label set in the old Cookies tab. The 10-category classification was later **dropped** in favour of OCD-vendor + scoper-action breakdown (see §7.2 Privacy guard); the OCD data file remains the input the cookie scoper reads.

---

## 5. Capability B — Cookie scoper

The background cleaner: rewrites tracker-cookie lifetimes so they can't keep recognising you tomorrow. Transplanted from the `hamr0/wearecooked` `port-kit` branch into `chrome-extension/scoper/`, rewired from cross-extension `sendMessage` to internal `chrome.storage.local`.

- **7-day cap, locked** — first-party cookies capped to 7d expiry. **Not user-tunable** (architecture decision).
- **Third-party demotion** — 3p tracker cookies demoted to **session** (killed on *browser* close).
- **Trust list** — sites you "live in" pass through; tiers **30d / 90d**, user-removed (no auto-expiry).
- **Sweep alarm** — periodic background sweep; period radio `15min / hourly (default) / 4hr / 12hr`.

> **Spec correction (kept as known limit).** UI once promised "kill on **tab** close." Per-tab cookie attribution is a large effort and not the common privacy mental model; **shipped behaviour is session-on-browser-close**, and UI copy reads "demoted to session." See §9 for the `partitionKey` (CHIPS) rewrite gap.

---

## 6. Capability C — Fingerprint farbler

Promotes the existing notify-only `inject.js` wrappers from "log" to "lie," gated by a per-origin policy. Built on the existing inject.js plumbing rather than a new shell.

### Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Wrappers in scope | 8 existing notify-only + WebGL `getParameter`, `deviceMemory`, `screen.*`, `performance.now()` (Tier A); canvas + audio + fonts (Tier B) | Tier A/B split |
| 2 | Per-origin behaviour model | **off / rotation / stable** *(see seed-scope revision)* | maps to "site that breaks under farbling" / "anonymous browsing" / "logged-in site" |
| 3 | Cookie-trust → stable linkage | **Automatic.** Site in `cookieScopeTrust` → stable farble, no second toggle | one mental model: "I live here" = "consistent fake identity here" |
| 4 | Same fake across logged-in sites? | **No — per-origin only.** seed = `HMAC(secret, origin)` | cross-site uniform fake re-enables tracker merge; per-origin kills cross-site merge even by embedded trackers |
| 7 | Global default | **ON** (`defaultBlurMode: 'rotation'`); cookie trust acts as auto-pass-through for logged-in sites | matches scoper's "default-ON, escape hatch via trust list" |
| 8 | Manual force-pass-through allowlist | **Yes**, separate from cookie trust (power-user surface) | real escape hatch for sites that trip anti-bot even under stable |
| 9 | "Force farble" override (trusted but still farble) | **Skip** | not worth the UI day one |
| 10 | Tier B algorithm source | **JShelter spec only**, Brave spec as cross-reference; no source lift | algorithms aren't copyrightable; keep GPL-3 source out |
| 11 | Seed secret rotation | **Secret never rotates** after first generation | rotation would break the "stable fake on trusted sites" property |

> **Superseded — seed-scope model (2026-05-20).** Locked decisions **#5 (per-tab seed dies on tab close)** and **#6 (per-origin-stable derived)** described a `per-tab` mode. Audit found the shipped `per-tab` mode was an **unwired stub** (hardcoded placeholder nonce → `per-tab` and `stable` were both just persistent-per-origin seeds). It was reframed around the real goal (cross-site **and** longitudinal unlinkability), because a *permanent* per-origin seed is itself a durable pseudonymous fingerprint — a stable tracking handle we mint and hand over.
>
> **Shipped model: `off` / `rotation` (default) / `stable`.**
> - **rotation** folds an SW-managed salt into the label (`rotation|<salt>|<origin>`) that regenerates on a **7-day window** (`bootstrapFarbleSalt`, single-writer in the SW; content script fails safe to `off` if absent). Stable within a window, unlinkable across windows. **Time-keyed, not session-keyed** — tab groups / session-restore mean browsers rarely close, so a `chrome.storage.session` salt would be effectively permanent.
> - **stable** keeps the persistent-per-origin seed as a **per-site pin** for frequently-logged-in sites, where rotation buys nothing (already identified by login) and only adds "new device" re-auth friction; strictly better there than `off` (which leaks the *real* fingerprint).
> - `inject.js` `farbleState()` whitelists `stable|rotation`; legacy `per-tab` settings fold to `rotation`. Storage key `farblerRotationSalt` (renamed from the misleading `farblerSessionSalt`). Per-site rules cycle blur `rotation → off → stable` (cycling to `rotation` removes the override).

### Seed derivation & call-time decision flow

```
Page calls navigator.hardwareConcurrency (or any wrapped surface)
  → wrapper fires notify()                                  (telemetry, always)
  → wrapper reads data-wh-farble-state + data-wh-farble-seed on <html>
       written by detect-watched.js (ISOLATED, document_start) after reading storage

  state === "off"      → return real value
  state === "stable"   → fake from HMAC(secret, origin)
  state === "rotation" → fake from HMAC(secret, "rotation|" + salt + "|" + origin)
```

Secret is generated once by the SW `onInstalled`/`onStartup`/top-level (idempotent), so the content script never bootstraps it — collapses the content-script chain to one `storage.local.get` + HMAC, which wins the race against early page probes. The DOM-attribute handshake was validated in POC (2026-05-18). The seed module lives **inline in `detect-watched.js`** (HMAC-SHA256 from `crypto.subtle` is ~30 lines; a separate file adds a manifest entry and ordering concern for no benefit).

### What shipped (surfaces)

- **Tier A (constants):** `navigator.languages`→`["en-US","en"]`, `deviceMemory`→8, `hardwareConcurrency`→4, `screen.{width,height}` snap-to-nearest of {1366×768, 1920×1080, 2560×1440, 3840×2160}, `screen.{colorDepth,pixelDepth}`→24, `performance.now()` floored to 100µs, WebGL `UNMASKED_RENDERER/VENDOR` fixed strings. `navigator.platform` is **notify-only (reverted)** — see §8.
- **Tier B (seeded):** canvas (`toDataURL`/`toBlob`/`getImageData`/`readPixels` WebGL1+2/`createImageBitmap`, via a generalized `farbleAnyCanvas` over `drawImage`); audio (`AudioBuffer.getChannelData` + `AnalyserNode.*`); fonts (`measureText` → one of 10 Win32 fonts at canonical widths). Perturbation = 100 pixels at **xorshift32 seed-derived positions** (anti-averaging). Size gates: skip < 1024 px (32×32 font probes) and > 1024×1024 px (legit exports). **Receiver-guard** (`Object.prototype.toString` brand-true) on every prototype-method wrapper; **WeakMap dedup** on `getChannelData` (additive noise must not accumulate across reads).
- **Sub-frame coverage:** `match_origin_as_fallback: true` on `inject.js` + `detect-watched.js` only.
- **Per-family kill (`famState` / `farbleDisableFamilies`):** every wrapper routes through `famState(fam)`; built as a diagnostic (isolate which surface breaks a site) and kept as the foundation for **per-site surface relaxing**.

### Relax offer (rage-reload → one-click pass-through)

When a user hammers reload on a page broken under blur, surface a one-click "relax fingerprint protection here." The **human is the sensor** — in-page auto-detection was rejected as unreliable (see §8). Two SW-level signals (both survive content-script teardown by anti-bot sites): `chrome.tabs.onUpdated` showing a genuine **2nd reload** within 25s while blur is on, and a main-frame **403** in `webRequest.onCompleted`. An in-page top banner (shadow-DOM + CSSOM styles, CSP-safe, top frame only) offers **relax & reload**; persist/reload/dismiss route through the SW (`wh-relax-site` sets `farblerSettings[etld1]={mode:'off',auto:true}`). Reload-detection semantics are derived from the **real captured `onUpdated` stream** (§8) — fires on the 2nd reload, time-based not `complete`-based so stuck anti-bot pages still count. Pairs with a future curated default-relax list (seed: nike.com).

---

## 7. UX surfaces

### 7.1 Popup — one site, right now

Three blocks + a Privacy guard card. Non-tech users scan for three things — *who's watching, what they're learning, where it goes* — so the old 10-card layout was consolidated (decided 2026-05-12; farbling folded into the guard card 2026-05-19).

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
┌─ Privacy guard ─────────────────────────
│  nytimes.com
│  ✓ Cookies expire in 7 days   ·  19 trimmed
│  ✓ Tracking blurred           ·  10 surfaces
│  [ trust cookies 30d ]   [ trust ID ]
│  ────────────────────────────────────────
│  113 trimmed today · 38k blurred surfaces this month
└────────────────────────────────────────
```

- **Score line stays.** `40 MODERATE` — the number is the wearehere signature for returning/comparing users; the plain-English verdict carries non-tech users. Both earn their pixels.
- **Mechanism vocabulary** (same across popup + dashboard): **cookies** (OCD name-matched), **pixels** (3p requests to tracker domains — covers iframes/scripts too), **device ID** (fingerprint-surface reads), **typing** (input-field watchers), **clicks** (outbound link tagging). A company appears under *Who's watching* if any fire; chips list the deduped union actually detected (no padding).
- **Who's-watching count rules:** 0 → `No trackers detected ✓` (chip line hidden); 1 → `Google`; 2 → `Google · Meta`; 3+ → `Google · Meta  +N more`. Ranked by mechanism-count.
- **Footer chips** collapse Selling / Terms / Pressure to one strip; only fired signals render (`✓ Not sold` / `⚠ Sold to brokers`, `✓ Terms OK` / `⚠ Terms hostile`, pressure badges). **Shipped deviation:** every chip always shows (predictable layout; ✓s are themselves affirmation) rather than collapsing to `✓ All clear`.
- **Privacy guard card** renders only fired mechanisms (collapses to `No protection active ✓` if neither). Cookies line states cap + per-site `trimmed`/`killed` (counts omitted when 0); blur line states `blurred · N surfaces` (or `stable seed` / `ID passing through`). Buttons name their target — `[ trust cookies 30d ]` / `[ trust ID ]`, becoming `[ untrust … ]` when active, and the active/trusted state renders in **caution amber** so a lowered-protection exception reads at a glance. `trust ID` sets the origin's blur mode to `off` (binary; `stable` is a dashboard-only finer choice). `Sweep now` and `trust 90d` are dashboard-only.

The popup is **glance + one action**; raw counts, splits, telemetry, trust-list management, per-mechanism breakdowns all live in dashboard tabs.

### 7.2 Dashboard — three tabs

Cut from 6 tabs to 3 (decided 2026-05-12): **Overview**, **Watchers**, **Privacy guard**. Removed: `Cookies` (→ Privacy guard "Cookies in your browser"), `Network` (→ Watchers `pixels`), `Terms` (→ Watchers 4th block), `Network Map` (dropped entirely — force-directed graphs are screenshot-pretty, rarely actionable).

**Overview — the time-based story** (the only "how am I trending / what changed?" surface; every other tab is current-state):
- Hero strip: `sites visited · avg score (Δ vs prior window) · watchers spotted (new) · cookies trimmed` + window selector (day/week/month/all). (4th cell switched from "most exposed" — it duplicated most-watched — to cookies trimmed, 2026-05-20.)
- **What changed** — per-window diff event log (new/gone watcher, reach grew/shrank ≥10pts, cookies grew ≥+10, score improved ≥5pts, sweep impact, new site), ranked by magnitude × visit-frequency. First-visit events collapse to one "N new sites" summary.
- **Browsing exposure** distribution — sites bucketed clean (`<30`) / mixed (`30–60`) / hostile (`60+`) by avg score (replaced the per-site score-trend zigzag, 2026-05-20). Score-trend chart kept as nice-to-have.
- **Impact line** — green callout: *"this week: wearehere shortened N cookies and demoted M trackers to session-only so they can't recognise you tomorrow."* Hidden when both counts are 0.

**Watchers — who follows you across the web** (per-site reality; not "who's on this site" — that's the popup):
- Hero: `sites visited · hidden contacts · unique watchers · 1 visit ≈ N hidden contacts` + window selector.
- **Who follows you** — companies ranked by reach % (visits seen / total). Plain `via cookies · pixels · clicks · device-id` line under each name (replaced the cryptic `C · P · ID` column, 2026-05-20); nonzero **Trimmed** / **Blurred** counts render in warn-yellow so real protection activity stands out.
- **Recent visits** — per-site tag-along count + top watchers + a **Terms** column (`18 ⚠` / `67 ✓`). `[ Clear history ]` resets the visit log only.
- **Terms block** — per-site clause breakdown (`⚠ Forced arbitration · clause 12.4` …) with site selector; defaults to most-exposed site / current tab / placeholder.

**Privacy guard — impact, population, management, audit** (was `Cookie scoper`; renamed when blur shipped in Phase 2 Slice 3). Both mechanisms under one roof, kept visually parallel so each is scannable without cross-decision pressure.
- **Lifetime hero:** `trimmed · blurred · sweeps run · last active`.
- **Cookies in your browser** — Coverage (capped 1p·7d / tracker demoted-to-session / trusted), By expiry (session / <7d / 7–30 / 30–90 / 90+), Top owners, `[ Inspect all N ▾ ]`.
- **Surfaces blurred** — parallel block on the *cumulative-work* axis: Coverage by family (canvas / audio / fonts / nav-screen / WebGL constants, from `farblerCounters.byFamily`), By mode (rotation / stable / off, derived from overrides + default), Top sites (`farblerBlurredBySite`).
- **Per-site rules** (merged, 2026-05-20) — one table keyed by eTLD+1 so a site's cookie *and* blur exception live on one row. Add row `[domain] (•) cookies ( ) blur [add]` (cookies-add → trust 30d; blur-add → `off`; neither touches the other axis). Cells cycle independently: cookies `7d → 30d → 90d → 7d`; blur `rotation → off → stable → rotation`. `[✕]` clears both axes; cycling a cell to default removes only that axis. Storage stays split (`cookieScopeTrust` + `farblerSettings`); the table is the live union, syncing with the popup's trust ID. Rows sort **newest-added first**, anchored by the **newer of the row's blur-override and cookie-trust `addedAt`** (so a cookie-only add, or a row whose blur cell cycled back to the default, still floats to top instead of sinking into the alphabetical block).
- **Settings** — Cookie sweep period (default hourly) + **Default blur** radio (off / stable per origin / **rotation**, default), each with a plain-language explainer. Retired the `farbleDevMode` SW-console toggle — blur ships ON by default. 7d cap is not exposed.
- **Recent activity** — unified sweeps + blur log (`cookieScopeHistory` + capped `farblerHistory`); collapsed by default.

> **Superseded layouts kept for history:** the intermediate "Cookie scoper" 5-block tab (lifetime hero / Cookies-in-browser / Trusted sites / Settings / Recent activity, 2026-05-12) and the separate **Trusted sites** + **Blur overrides** tables (pre-2026-05-20) are replaced by the Privacy guard layout above. The old standalone Cookies tab's 10-category classification, the `TRACKING/ADS` stat card, and the `Clean Cookies` CTA were all dropped (OCD-vendor + scoper-action supersedes; `Sweep now` is the one verb).

---

## 8. Decision log — findings preserved

Chronological. Nothing here is dropped; current design (§1–§7) reflects the net of these.

### Phase 0 survey learnings (2026-05-12)

- **Maintenance-mode ≠ API death.** Cookie AutoDelete / JShelter are stalled on MV3 port effort + maintainer time, not API removal. `chrome.cookies` and `chrome.scripting` MAIN-world are alive in MV3 — the techniques still work; lift the knowledge.
- **Lift knowledge, not plumbing.** The value is the curated data (lists, taxonomies, surface enumerations); MV2 background-page plumbing is throwaway.
- **Lists are facts, code is code.** (See §4 license posture.)
- **Detection-only premise (later revised).** Phase 0 deliberately resisted intervention to protect truth-of-observation. **Reversed 2026-05-12** when the cookie scoper moved in-house: wearehere now intervenes, but scoped/swept items are explicitly labelled, preserving the premise.

### Architecture reversal — scoper lives in wearehere (2026-05-12)

Original Phase 0 routed cookie scoping to a separate "wearecooked v5" extension. **Reversed:** wearecooked v5 will not ship; the scoper ships inside wearehere (one install, one storage, no cross-extension messaging). The `port-kit` branch (phase 1, harness 21/21) is the starting-point code to transplant. Decisions previously labelled "wearecooked v5 PRD" (7d cap, trust durations, tab layout, sweep radio) still hold — only the host changed.

### Build-gaps audit (2026-05-12) — historical, now largely shipped

The new design was materially a rewrite (old extension was per-tab in-memory only). Audited gaps, since shipped through v4.0.0: add `storage` + `alarms` permissions; cross-session schema (`visitHistory`, `windowSnapshots`, `scoreHistory`, scoper keys); popup 3-block rewrite + mechanism dedup + scoper card; Overview "what changed" diff + hero; Watchers cross-session aggregation + Terms fold; new internal `scoper/` module (sweep alarm, cookie rewrite, tab-close 3p deletion) + its storage schema. Retained here as the record of what the v4 build closed.

### v4.x — shipped polish & deliberate deviations (2026-05-13)

- **Shipped:** first-run onboarding modal (`dashboardOnboarded`), Overview impact line, Phase 7 Firefox mirror (4.1.0, drift-verified `diff -rq`), four race-condition fixes (4.1.0), content-script lifecycle hardening (4.1.4 — clean exit past extension reload; `getReport` falls back to `pendingVisit` after SW recycle).
- **Deliberate deviations (keep as-is):** always-show footer chips (no "All clear" collapse); score-trend uses per-visit `visitHistory` dots rather than a separate `scoreHistory` key.
- **8-step manual smoke test** stays a human-in-the-loop checklist (`test/SMOKE.md`); the unit suite covers the data pipeline. Run both bundles after each store cycle.

### Pre-Firefox-mirror code review (2026-05-13) — fixed inline

Dead `gated/anchorSize` popup branch removed; `tabs.onRemoved` ordering (`markTabRemoved` before `snapshotAndEvict`); `activeTab` permission dropped; `registerDashboard` reuse wired; `fetchCookies` substring match → eTLD+1 (`etld1ForCookie`); trust-list + `visitHistory` write races serialized; `bgFetch` redirect re-check (`safeBgFetch`, `redirect:'manual'`, re-runs `isSafeBgFetchUrl` per hop, `MAX_BG_REDIRECTS=5`); `renderWhatChanged` placeholder wrapped in `escapeText`; snapshot `watcherMech` case-sensitivity lowercased.

### Farbler — resolved before Slice 2 (2026-05-18)

- **Font cap list:** single Win32 list of 10 (Arial, Times New Roman, Courier New, Verdana, Georgia, Tahoma, Trebuchet MS, Comic Sans MS, Impact, Lucida Console). Pairs with the (later reverted) `platform=Win32` lie for internal consistency; webfont fallback chains absorb most non-Windows cases.
- **`screen.*` buckets:** four, **snap-to-nearest** (1440×900 → 1366×768; 3000×2000 → 2560×1440). Avoids both quality hits and hard-coded-breakpoint breakage.
- **`hardwareConcurrency`:** 4 (modal value, max population blend; lower values stand out *more*).
- **Stable farble + embedded ad-tech:** per-origin stable means DoubleClick on Gmail sees Gmail's seed, on Reddit sees Reddit's — different seeds, no cross-site merge. Working as designed; documented for users.

### Farbler — resolved during Slice 2 design (2026-05-19)

- **Canvas fingerprints are cryptographic hashes (avalanche).** Any single byte change → completely unrelated hash; "more noise" doesn't help. Spread perturbation across many pixels only for (a) robustness vs averaging multiple readings and (b) vs region-specific hashing.
- **Performance gate (upper):** skip canvases > 1024×1024 — 4K canvases are almost never FP vectors (fingerprinters use 200×50–500×100); saves 30–50ms on legit exports with ~zero privacy loss.
- **Anti-averaging:** spread the 100 perturbations at seed-derived pseudo-random (xorshift) positions, not fixed stride.
- **WebGL `getParameter` constant lies in Slice 2** (not Slice 1) — we're wrapping WebGL anyway for `readPixels`. Other Tier A surfaces stay in Slice 1.
- **Attribute contract:** POC's binary `data-wh-farble="on"` → `data-wh-farble-state` (`off|stable|per-tab`→now `rotation`) + `data-wh-farble-seed` (hex).
- **Sub-frame:** `match_origin_as_fallback: true` (iframe inherits parent origin → `<all_urls>` matches via fallback).

### Farbler — resolved during Slice 2 build (2026-05-19)

- **Real-world readback volume is high.** creepjs triggers ~150 `getImageData`/load (mostly font/rects/svg/emoji sub-tests). Implication: stay cheap on the small-canvas hot path → **lower gate: skip < 1024 px** (32×32). Calibrated down from an initial 4096 after logs showed the primary canvas-2d test uses 40×40 (1600) and 50×50 (2500) — both real vectors that must stay above the gate.
- **DEBUG-gating locked:** every wrapper log is `DEBUG && console.log(...)`, `var DEBUG=false` at IIFE top (wrappers fire 150+×/page; ungated logs flood real consoles).
- **Seed module inline in `detect-watched.js`** (~30 lines; revisit past ~100 lines or if it needs isolated unit-testing).
- **WebGL canvas readback bypass:** `toDataURL`/`toBlob` on a WebGL canvas encode the framebuffer without going through `readPixels` → generalize `farbleCanvas2D` to `farbleAnyCanvas(src,seed)` via `drawImage(src,0,0)` onto a fresh 2D offscreen (uniform for 2D + WebGL sources).
- **First-ever-install race:** when `farblerSecret` is missing, the content-script bootstrap chain loses the race against early probes (~9 leaked `state=off` readbacks on creepjs). **Fix: generate the secret in the SW `onInstalled`** so the content script only does `get` + HMAC. Narrow first-install leak accepted for the build steps, gone by the SW-bootstrap step.
- **`match_origin_as_fallback` advanced out-of-order** (right after WebGL constants) so every later module is tested with iframe coverage. Scope-limited to `inject.js` + `detect-watched.js`.
- **Sandboxed-iframe ceiling (acknowledged unfarble-able):** browserleaks runs probes in `<iframe sandbox>` without `allow-scripts`; Chrome blocks ALL script execution there. No content-script extension can farble these. (See §3b table.)
- **Receiver-guard pattern locked:** creepjs probes for instrumentation via `Proto.method.call(plainObject)` (native throws `Illegal invocation` with zero side effects). Our wrappers were `notify()`-ing + logging on these. **Fix:** brand-true guard (`Object.prototype.toString.call(x) === "[object HTMLCanvasElement]"` etc.) at the top of every prototype-method wrapper; on failure call `original.apply` directly, no logging/notify/farble — bit-identical to native, cross-realm safe. Tier A property getters are auto-protected (descriptors, not methods).
- **Fractional-dim `readPixels`** (creepjs `readPixels(0,0,17.066…,42.666…)`): area ≈728 px < gate, gated correctly; `(w>>>0)*(h>>>0)` float-coercion also lands below gate. No change.
- **`willReadFrequently` console warning:** keyed to creepjs's own canvas creator, not our wrapper; immutable after `getContext`. Action: none.
- **WeakMap dedup for mutable-ref returns:** `getChannelData` returns a *reference*; additive (non-self-cancelling) noise would accumulate across reads → detection signal. Fix: `WeakMap<AudioBuffer, Set<channel>>` returns the same already-perturbed ref. General rule: any wrapper returning a mutable internal-state ref with non-self-cancelling perturbation needs this. (XOR canvas perturbations self-cancel, so canvas wrappers must *not* use it.)
- **"API corrupted" count rises monotonically:** creepjs counts prototype methods whose source ≠ native (9 → 14 after audio). This is the cost of wrapping, not a bug — Brave/RFP show the same. A zero-corrupted defense needs renderer-level patching.
- **`navigator.platform` reverted to notify-only:** creepjs reads platform from main-thread `navigator.platform` (patchable), `userAgentData.platform` (UAch — not patchable from a content script), and Worker scope (unreachable). Spoofing only the main thread made the three disagree → strong "platform-spoofing extension" signal → **more** identifiable. Brave reached the same conclusion in 2020. **Pattern lock:** before farbling a constant, audit whether it's also exposed via UAch / UA string / Worker scope — if yes, patch all or don't farble (partial spoofing is anti-defense). `deviceMemory` / `hardwareConcurrency` Worker leakage is the same class but kept (mainstream FP queries main-thread).

### Farbler — resolved during Slice 3 (compat + per-site relax, 2026-05-20)

- **Per-surface disable infra (`famState` / `farbleDisableFamilies`)** — see §6.
- **Anti-bot aggregate tamper is unfarble-able per-surface (Nike / Akamai):** disabling each family individually didn't fix nike.com's spinner/ghost-frame hang; disabling all five did. No single wrapper is the offender — Akamai blocks on *any* detected tampering. Hardening one wrapper can't fix this class; relax the whole site. (See §3b table.)
- **In-page auto-detect rejected → rage-reload offer shipped:** an in-page watchdog (LCP/spinner/text heuristics → A/B reload) is unreliable (placeholders register LCP, nav text defeats text thresholds, `load` ≠ rendered, Akamai tears down our context mid-spin). Shipped the human-as-sensor SW-level relax offer instead (see §6). Doing persist/reload page-side was the original bug — anti-bot sites detach the banner's content-script context right after render, so its own `chrome.storage` callback never fired; routing through the SW fixed it.
- **`measureText` all-zero bounding boxes — correctness bug:** `fakeTextMetrics(width)` zeroed every box field; layout code dividing by ascent/line-height gets `NaN`/`Infinity`. **Fix: return plausible non-zero metrics from font size** (ascent ≈ 0.8×, descent ≈ 0.2×) while keeping canonical per-bucket `width`. *(Still open — see §9.)*
- **Seed-scope model: weekly rotation; `per-tab` dropped** — the headline Slice 3 revision; full text in §6 (superseded note).

### Farbler — resolved during Slice 3 hardening (2026-05-21)

- **Rage-reload fired on navigation; reworked to real `onUpdated` semantics.** Old code counted *any* same-tab `loading` and keyed on `tab.url` (which lags at `loading`) → successive Google searches looked like reloads. **Captured the actual `onUpdated` stream** (don't trust docs): a navigation emits `{loading, url:NEW}` *plus* later **url-less** `{loading}` sub-events; a reload emits **no** url-bearing loading event. So `changeInfo.url` present → navigation → reset streak + stamp `navAt`; a url-less `loading` is a reload **unless** within `NAV_SUBEVENT_MS` of the stamp. `RELAX_DEDUPE_MS` collapses the within-reload burst; fires on the 2nd reload (`RELAX_MIN_RELOADS`). Time-based, not `complete`-based. Rejected `webNavigation.onCommitted`+`transitionType==='reload'` (textbook-clean) — needs `webNavigation` ("Read your browsing history" warning + forced re-grant). Validated against captured Google + nike streams in a `vm` harness.
- **ToS cache persisted (`tosCacheV1`).** Was in-memory only → evaporated on SW recycle → a found terms page reverted to "couldn't find one" on the next cold popup. Now persisted: merge-keeps known privacy/terms axes (never clobbers a found page with a later null), TTL 30d found / 1d miss, cap 500 oldest-first. `checkCache` hardened with `try/catch` so a throw can't hang `detect-tosed`'s callback (which would skip the scan). The scoring logic was never the problem (real-source `vm` harness = 100%); the flakiness was purely the volatile cache.
- **Per-site keys made suffix-aware (curated PSL subset).** `*.co.uk` / `*.github.io` were over-grouped (relaxing `abrahamjuliot.github.io` hit all `*.github.io`). **No structural rule works:** `github.io` (delegated) and `sentry.io` (single-owner) are identical shape `x.y.io`, opposite answers — only a curated list knows. ~45-entry set, byte-identical across the five sites (§2). Seed is per-origin so default protection was unaffected; old keys self-heal, no migration. Legacy `defaultBlurMode:'per-tab'` rewritten to `rotation` by a one-time startup migration. Full PSL deferred.

### POC bug-classes to NEVER reintroduce

1. **Dual injection** — don't inject `inject.js` from both `manifest.json` AND a dynamic `<script>`. Double-wrapping each method makes XOR perturbations cancel (XOR twice = original). Manifest static injection is canonical.
2. **Self-recursion through wrappers** — internal use of a wrapped API (e.g. `farbleAnyCanvas` calling `ctx.getImageData()`) hits our own wrapper → double-perturb → cancel. **Capture the original ref at IIFE top** (`var ORIG_GET_IMAGE_DATA = …`) and use it inside farbling code.
3. **Async storage race vs install** — wrappers install at `document_start`; storage reads are async. Read the seed/state attribute **at call-time**, not install-time.

### Phase 3 candidates (NOT committed) — captured 2026-05-19 so we don't re-derive

- **4-bucket policy model** (generalizes the 3-state): (a) **logged-in first-party** (password submit / OAuth callback / explicit marker) → stable; (b) **other first-party / 3p with history** → rotation; (c) **user allowlist** → off; (d) **no-history 3p over a FP-call-rate threshold** → farble first N then block subsequent calls from that script ID. Allowlist ships **empty** — users curate.
- **Behavioral login detection** (`farblerLoggedIn`, survives cookie wipes): password-form submit, SSO/OAuth callback URLs, explicit "I have an account here."
- **"Block" in bucket d** is per-call/per-script enforcement *after* observing N FP calls (throw `SecurityError`), **not** declarativeNetRequest (uBlock's lane). Defensible UX: "we measured them fingerprinting, you have no relationship, so we stopped them."
- **Open questions:** empirically tune the FP-rate threshold (Stripe/reCAPTCHA/photo-editors vs FingerprintJS/creepjs); does block-after-threshold itself become detectable (mitigate with delay + null/zeroed return mimicking permission denial); Worker-context bypass remains; cross-extension `farblerLoggedIn` sync deferred.

### Slice plan (historical — all slices shipped; see §9 progress for verification)

Work order was **Slice 2 first** (hard-part-first): Tier B seeded farbling + WebGL constants (10-step build order, "do not deviate without updating the PRD"). Then **Slice 1** (Tier A coverage + per-origin model). Then **Slice 3** (visibility layer + UX). Each independently shippable. Done-when gates and the numbered build order are preserved in git history of this file; all gates were satisfied per the progress tracker.

---

## 9. Known issues & deferred work

| Item | Severity | Where | Notes |
|---|---|---|---|
| `measureText` all-zero bounding boxes | correctness bug | `inject.js` `fakeTextMetrics` | Return non-zero metrics (ascent ≈ 0.8×size, descent ≈ 0.2×size), keep canonical width. Real breakage risk on layout code dividing by ascent. |
| Full PSL vs curated ~45-entry subset | deferred | the five eTLD+1 sites | Curated set covers common offenders; ~10k list + update story + key migration is its own task. |
| Curated default-relax list (seed nike.com) | optional follow-up | `background.js` | So the biggest anti-bot offenders never hit the relax wall. |
| Tab-close 3p deletion not implemented | spec correction | scoper | No `tabs.onRemoved` cookie handler; UI reads "demoted to session" (= killed on browser close), which matches actual behaviour. Per-tab attribution is a large effort and not the common mental model. |
| `partitionKey` (CHIPS) not preserved on rewrite | Critical (edge) | scoper | `chrome.cookies.set` drops `partitionKey`; rewritten partitioned trackers collapse to one unpartitioned cookie. Track separately. |
| Worker / OffscreenCanvas fingerprinting | acknowledged gap | farbler | Content-script wrappers don't reach Worker globals; rare in mainstream FP libs. |
| `persistPendingVisit` writes session-storage per `detection` | Important | `background.js` | Heavy SPAs may approach the per-minute write cap; one-line debounce, deferred until observed. |
| SPA `pushState` → one visit record | Important | `tabs.onUpdated` | Fixing needs `webNavigation` (extra AMO ask). Acceptable trade-off. |
| `scoper:ensureAlarm` may reset next-fire on SW wake | Important | scoper | Mirror the `chrome.alarms.get` pre-check `SNAPSHOT_ALARM` uses. |
| `buildSetDetails` null on `sameSite=no_restriction && !Secure` counted as `failed` | Important | scoper | Telemetry shows phantom failures; cosmetic. |
| Popup trust-input validates URL-shape weakly | Important | `popup.js` | Accepts `localhost.com`, IPs, `..invalid..`. Self-inflicted, not security. |
| Footer-chip expand-on-click for ⚠ chips | low | `popup.js/html` | PRD spec: ⚠ chip expands into a full card. Today plain text. |
| What-changed `[ Show all (N) ]` expander | low | `report.js renderWhatChanged` | Caps at 20, no expander; spec is cap 8 + expander. |
| What-changed ranking by magnitude × visit-frequency | low | `report.js diffAggregates` | Today appended in detection order; needs per-site visit-count from snapshot. |
| Score-trend prior-window comparison footer | low | `report.js renderScoreTrend` | Shows "avg N · range X→Y", not "this month vs last month". |
| "Inspect all N cookies" expander | low | `report.js` Privacy guard | Collapsed full per-cookie table (vendor · category · expiry · domain · scoper-action). |
| Last-two-labels eTLD+1 in non-rule code | Minor | `network-domains.js:560`, `visits.js:44`, `report.js` device-id/recent-visits | Company/visit/display grouping, not rule keys — deliberately left; cosmetic only. (Rule keys are PSL-aware per §2.) |
| No CSP declared in manifest | Minor | manifest | MV3 default CSP is strict; optional defense-in-depth. |
| Stack-walk wrap set in `inject.js` intentionally minimal | Minor | `inject.js` | No `getImageData`/`toBlob`/`OffscreenCanvas`/WebGL2 stack-walk surfaces; per vocabulary lock. Tests for the locked set don't exist yet. |
| `compactVisit` brokerCount fallback | Minor | `report.js` | Can show "5 brokers" with zero names; one-line fix. |
| Test-coverage gaps | Minor | suite | `safeBgFetch` redirect chain, `removedTabs` LRU eviction, `snapshotAndEvict` recovery, `cookieScopeCounters.bySite`, `buildSetDetails` `__Host-` violations, message-handler cross-check. Add post-FF-mirror so both extensions benefit. |
| Add the `vm` stress harness to the repo | offered | `/tmp/wh-stress/stress.js` | 47/47 over real extracted source (scanText/getPageType/findPolicyLinks, suffix-aware eTLD+1, Option-A relax via captured streams, ToS persistence, TTL). Not yet committed; would be a regression guard. |
| Phase 6 cleanup — dead CSS / retired-tab images | pending | repo | Remove dead CSS classes, retired-tab PNGs (`baked/cooked/played/linked/silent/tosed/watched/leaking.png`), unreachable manifest permissions. Single contained commit. |

---

## 10. References

- **Build sequence & dependency graph:** [PLAN.md](./PLAN.md) — *what* is here; *how/in-what-order* is there. Chrome first, Firefox mirror last.
- **Changelog:** `CHANGELOG.md` `## [5.0.0]`.
- JShelter wrappers list: vendored at `chrome-extension/fingerprint-surfaces.js` (149 surfaces, 12 categories).
- Open Cookie Database: vendored at `chrome-extension/cookie-database.js`.
- POC validation transcript: 2026-05-18 — `data-wh-farble="on"` → `navigator.hardwareConcurrency === 4`.
- Shared rules: `.claude/memory/AGENT_RULES.md`.
- Attribution for borrowed lists: [NOTICE](../../NOTICE).
