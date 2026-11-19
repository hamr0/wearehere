---
title: Decision log
slug: decisions
gloss: "Decision log: choices with rationale, reversals, POC bug-classes, Phase 3 candidates, slice history"
source: docs/archive/PRD.md
---

# Decision log

Chronological. Nothing is dropped; current design reflects the net of these (docs/archive/PRD.md:268-270).

## Binding invariants: POC bug-classes to NEVER reintroduce

These are binding. Violating any one breaks farbling (docs/archive/PRD.md:343-347).

1. **Dual injection.** Do not inject `inject.js` from both `manifest.json` AND a dynamic `<script>`. Double-wrapping makes XOR perturbations cancel (XOR twice = original). Manifest static injection is canonical (docs/archive/PRD.md:345).
2. **Self-recursion through wrappers.** Internal use of a wrapped API (e.g. `farbleAnyCanvas` calling `ctx.getImageData()`) hits our own wrapper, double-perturbs and cancels. Capture the original ref at IIFE top (`var ORIG_GET_IMAGE_DATA = ...`) and use it inside farbling code (docs/archive/PRD.md:346).
3. **Async storage race vs install.** Wrappers install at `document_start`; storage reads are async. Read the seed/state attribute at call-time, not install-time (docs/archive/PRD.md:347).

## Phase 0 survey learnings (2026-05-12)

- Maintenance-mode is not API death. Cookie AutoDelete / JShelter are stalled on MV3 port effort and maintainer time, not API removal; `chrome.cookies` and `chrome.scripting` MAIN-world are alive in MV3 (docs/archive/PRD.md:274).
- Lift knowledge, not plumbing. The value is curated data (lists, taxonomies, surface enumerations); MV2 background-page plumbing is throwaway (docs/archive/PRD.md:275).
- Lists are facts, code is code (see §4 license posture) (docs/archive/PRD.md:276).
- **Reversal.** Detection-only premise: Phase 0 deliberately resisted intervention to protect truth-of-observation. Reversed 2026-05-12 when the cookie scoper moved in-house; wearehere now intervenes, but scoped/swept items are explicitly labelled, preserving the premise (docs/archive/PRD.md:277).

## Architecture reversal: scoper lives in wearehere (2026-05-12)

- Original Phase 0 routed cookie scoping to a separate "wearecooked v5" extension. Reversed: wearecooked v5 will not ship; the scoper ships inside wearehere (one install, one storage, no cross-extension messaging) (docs/archive/PRD.md:281).
- The `port-kit` branch (phase 1, harness 21/21) is the starting-point code to transplant (docs/archive/PRD.md:281).
- Decisions labelled "wearecooked v5 PRD" (7d cap, trust durations, tab layout, sweep radio) still hold; only the host changed (docs/archive/PRD.md:281).

## Build-gaps audit (2026-05-12), historical and largely shipped

- The new design was materially a rewrite (old extension was per-tab in-memory only) (docs/archive/PRD.md:285).
- Audited gaps, shipped through v4.0.0: `storage` + `alarms` permissions; cross-session schema (`visitHistory`, `windowSnapshots`, `scoreHistory`, scoper keys); popup 3-block rewrite + mechanism dedup + scoper card; Overview "what changed" diff + hero; Watchers cross-session aggregation + Terms fold; new internal `scoper/` module (sweep alarm, cookie rewrite, tab-close 3p deletion) + its storage schema (docs/archive/PRD.md:285).

## v4.x shipped polish and deliberate deviations (2026-05-13)

- Shipped: first-run onboarding modal (`dashboardOnboarded`), Overview impact line, Phase 7 Firefox mirror (4.1.0, drift-verified `diff -rq`), four race-condition fixes (4.1.0), content-script lifecycle hardening (4.1.4: clean exit past extension reload; `getReport` falls back to `pendingVisit` after SW recycle) (docs/archive/PRD.md:289).
- Deliberate deviations, keep as-is: always-show footer chips (no "All clear" collapse); score-trend uses per-visit `visitHistory` dots rather than a separate `scoreHistory` key (docs/archive/PRD.md:290).
- The 8-step manual smoke test stays a human-in-the-loop checklist (`test/SMOKE.md`); the unit suite covers the data pipeline. Run both bundles after each store cycle (docs/archive/PRD.md:291).

## Pre-Firefox-mirror code review (2026-05-13), fixed inline

- Dead `gated/anchorSize` popup branch removed; `tabs.onRemoved` ordering (`markTabRemoved` before `snapshotAndEvict`); `activeTab` permission dropped; `registerDashboard` reuse wired (docs/archive/PRD.md:295).
- `fetchCookies` substring match changed to eTLD+1 (`etld1ForCookie`); trust-list + `visitHistory` write races serialized (docs/archive/PRD.md:295).
- `bgFetch` redirect re-check (`safeBgFetch`, `redirect:'manual'`, re-runs `isSafeBgFetchUrl` per hop, `MAX_BG_REDIRECTS=5`) (docs/archive/PRD.md:295).
- `renderWhatChanged` placeholder wrapped in `escapeText`; snapshot `watcherMech` case-sensitivity lowercased (docs/archive/PRD.md:295).

## Farbler: resolved before Slice 2 (2026-05-18)

- **Font cap list:** single Win32 list of 10 (Arial, Times New Roman, Courier New, Verdana, Georgia, Tahoma, Trebuchet MS, Comic Sans MS, Impact, Lucida Console). Paired with the (later reverted) `platform=Win32` lie for internal consistency; webfont fallback chains absorb most non-Windows cases (docs/archive/PRD.md:299).
- **`screen.*` buckets:** four, snap-to-nearest (1440x900 to 1366x768; 3000x2000 to 2560x1440). Avoids both quality hits and hard-coded-breakpoint breakage (docs/archive/PRD.md:300).
- **`hardwareConcurrency`:** 4 (modal value, max population blend; lower values stand out more) (docs/archive/PRD.md:301).
- **Stable farble + embedded ad-tech:** per-origin stable means DoubleClick on Gmail sees Gmail's seed, on Reddit sees Reddit's; different seeds, no cross-site merge. Working as designed; documented for users (docs/archive/PRD.md:302).

## Farbler: resolved during Slice 2 design (2026-05-19)

- **Canvas fingerprints are cryptographic hashes (avalanche).** Any single byte change gives a completely unrelated hash; "more noise" does not help. Spread perturbation across many pixels only for robustness vs averaging multiple readings and vs region-specific hashing (docs/archive/PRD.md:306).
- **Performance gate (upper):** skip canvases > 1024x1024; 4K canvases are almost never FP vectors (fingerprinters use 200x50 to 500x100); saves 30-50ms on legit exports with ~zero privacy loss (docs/archive/PRD.md:307).
- **Anti-averaging:** spread the 100 perturbations at seed-derived pseudo-random (xorshift) positions, not fixed stride (docs/archive/PRD.md:308).
- **WebGL `getParameter` constant lies in Slice 2** (not Slice 1), since WebGL is wrapped anyway for `readPixels`. Other Tier A surfaces stay in Slice 1 (docs/archive/PRD.md:309).
- **Attribute contract:** POC's binary `data-wh-farble="on"` became `data-wh-farble-state` (`off|stable|per-tab`, now `rotation`) + `data-wh-farble-seed` (hex) (docs/archive/PRD.md:310).
- **Sub-frame:** `match_origin_as_fallback: true` (iframe inherits parent origin, so `<all_urls>` matches via fallback) (docs/archive/PRD.md:311).

## Farbler: resolved during Slice 2 build (2026-05-19)

- **Real-world readback volume is high.** creepjs triggers ~150 `getImageData` per load. Stay cheap on the small-canvas hot path: lower gate skips < 1024 px (32x32). Calibrated down from an initial 4096 after logs showed the primary canvas-2d test uses 40x40 (1600) and 50x50 (2500), both real vectors that must stay above the gate (docs/archive/PRD.md:315).
- **DEBUG-gating locked:** every wrapper log is `DEBUG && console.log(...)`, `var DEBUG=false` at IIFE top (wrappers fire 150+ times per page) (docs/archive/PRD.md:316).
- **Seed module inline in `detect-watched.js`** (~30 lines; revisit past ~100 lines or if it needs isolated unit-testing) (docs/archive/PRD.md:317).
- **WebGL canvas readback bypass:** `toDataURL`/`toBlob` on a WebGL canvas encode the framebuffer without going through `readPixels`; generalize `farbleCanvas2D` to `farbleAnyCanvas(src,seed)` via `drawImage(src,0,0)` onto a fresh 2D offscreen (docs/archive/PRD.md:318).
- **First-ever-install race:** when `farblerSecret` is missing, the content-script bootstrap loses the race against early probes (~9 leaked `state=off` readbacks on creepjs). Fix: generate the secret in the SW `onInstalled` so the content script only does `get` + HMAC. Narrow first-install leak accepted for the build steps, gone by the SW-bootstrap step (docs/archive/PRD.md:319).
- **`match_origin_as_fallback` advanced out-of-order** (right after WebGL constants) so every later module is tested with iframe coverage. Scope-limited to `inject.js` + `detect-watched.js` (docs/archive/PRD.md:320).
- **Sandboxed-iframe ceiling (acknowledged unfarble-able):** browserleaks runs probes in `<iframe sandbox>` without `allow-scripts`; Chrome blocks ALL script execution there. No content-script extension can farble these (see §3b table) (docs/archive/PRD.md:321).
- **Receiver-guard pattern locked:** creepjs probes instrumentation via `Proto.method.call(plainObject)` (native throws `Illegal invocation`, zero side effects). Our wrappers were notifying and logging on these. Fix: brand-true guard (`Object.prototype.toString.call(x) === "[object HTMLCanvasElement]"` etc.) at the top of every prototype-method wrapper; on failure call `original.apply` directly with no logging/notify/farble, bit-identical to native and cross-realm safe. Tier A property getters are auto-protected (descriptors, not methods) (docs/archive/PRD.md:322).
- **Fractional-dim `readPixels`** (creepjs `readPixels(0,0,17.066...,42.666...)`): area ~728 px < gate, gated correctly; `(w>>>0)*(h>>>0)` float-coercion also lands below gate. No change (docs/archive/PRD.md:323).
- **`willReadFrequently` console warning:** keyed to creepjs's own canvas creator, not our wrapper; immutable after `getContext`. Action: none (docs/archive/PRD.md:324).
- **WeakMap dedup for mutable-ref returns:** `getChannelData` returns a reference; additive (non-self-cancelling) noise would accumulate across reads, a detection signal. Fix: `WeakMap<AudioBuffer, Set<channel>>` returns the same already-perturbed ref. General rule: any wrapper returning a mutable internal-state ref with non-self-cancelling perturbation needs this. XOR canvas perturbations self-cancel, so canvas wrappers must not use it (docs/archive/PRD.md:325).
- **"API corrupted" count rises monotonically:** creepjs counts prototype methods whose source differs from native (9 to 14 after audio). This is the cost of wrapping, not a bug; Brave/RFP show the same. A zero-corrupted defense needs renderer-level patching (docs/archive/PRD.md:326).
- **Reversal: `navigator.platform` reverted to notify-only.** creepjs reads platform from main-thread `navigator.platform` (patchable), `userAgentData.platform` (UAch, not patchable from a content script), and Worker scope (unreachable). Spoofing only the main thread made the three disagree, a strong "platform-spoofing extension" signal, so more identifiable. Brave reached the same conclusion in 2020 (docs/archive/PRD.md:327).
- **Pattern lock:** before farbling a constant, audit whether it is also exposed via UAch / UA string / Worker scope; if yes, patch all or don't farble (partial spoofing is anti-defense). `deviceMemory` / `hardwareConcurrency` Worker leakage is the same class but kept (mainstream FP queries main-thread) (docs/archive/PRD.md:327).

## Farbler: resolved during Slice 3, compat + per-site relax (2026-05-20)

- Per-surface disable infra (`famState` / `farbleDisableFamilies`): see §6 (docs/archive/PRD.md:331).
- **Anti-bot aggregate tamper is unfarble-able per-surface (Nike / Akamai):** disabling each family individually did not fix nike.com's spinner/ghost-frame hang; disabling all five did. No single wrapper is the offender, Akamai blocks on any detected tampering. Relax the whole site (see §3b table) (docs/archive/PRD.md:332).
- **Rejected: in-page auto-detect; shipped rage-reload offer instead.** An in-page watchdog (LCP/spinner/text heuristics then A/B reload) is unreliable: placeholders register LCP, nav text defeats text thresholds, `load` is not rendered, Akamai tears down our context mid-spin. Shipped the human-as-sensor SW-level relax offer (see §6). Persist/reload page-side was the original bug: anti-bot sites detach the banner's content-script context right after render, so its `chrome.storage` callback never fired; routing through the SW fixed it (docs/archive/PRD.md:333).
- **`measureText` all-zero bounding boxes, a correctness bug:** `fakeTextMetrics(width)` zeroed every box field; layout code dividing by ascent/line-height gets `NaN`/`Infinity`. Fix: return plausible non-zero metrics from font size (ascent ~0.8x, descent ~0.2x) while keeping canonical per-bucket `width`. Still open; see §9 (docs/archive/PRD.md:334).
- **Seed-scope model: weekly rotation; `per-tab` dropped.** The headline Slice 3 revision; full text in §6 (superseded note) (docs/archive/PRD.md:335).

## Farbler: resolved during Slice 3 hardening (2026-05-21)

- **Rage-reload fired on navigation; reworked to real `onUpdated` semantics.** Old code counted any same-tab `loading` and keyed on `tab.url` (which lags at `loading`), so successive Google searches looked like reloads. Captured the actual `onUpdated` stream rather than trusting docs: a navigation emits `{loading, url:NEW}` plus later url-less `{loading}` sub-events; a reload emits no url-bearing loading event (docs/archive/PRD.md:339).
- Rule: `changeInfo.url` present means navigation (reset streak, stamp `navAt`); a url-less `loading` is a reload unless within `NAV_SUBEVENT_MS` of the stamp. `RELAX_DEDUPE_MS` collapses the within-reload burst; fires on the 2nd reload (`RELAX_MIN_RELOADS`). Time-based, not `complete`-based. Validated against captured Google + nike streams in a `vm` harness (docs/archive/PRD.md:339).
- **Rejected:** `webNavigation.onCommitted` + `transitionType==='reload'` (textbook-clean) because it needs `webNavigation` ("Read your browsing history" warning + forced re-grant) (docs/archive/PRD.md:339).
- **ToS cache persisted (`tosCacheV1`).** Was in-memory only, so it evaporated on SW recycle and a found terms page reverted to "couldn't find one" on the next cold popup. Now persisted: merge-keeps known privacy/terms axes (never clobbers a found page with a later null), TTL 30d found / 1d miss, cap 500 oldest-first. `checkCache` hardened with `try/catch` so a throw cannot hang `detect-tosed`'s callback. The scoring logic was never the problem (real-source `vm` harness = 100%); the flakiness was the volatile cache (docs/archive/PRD.md:340).
- **Per-site keys made suffix-aware (curated PSL subset).** `*.co.uk` / `*.github.io` were over-grouped (relaxing `abrahamjuliot.github.io` hit all `*.github.io`). No structural rule works: `github.io` (delegated) and `sentry.io` (single-owner) have identical shape `x.y.io` and opposite answers, so only a curated list knows. ~45-entry set, byte-identical across the five sites (§2). Seed is per-origin so default protection was unaffected; old keys self-heal, no migration. Legacy `defaultBlurMode:'per-tab'` rewritten to `rotation` by a one-time startup migration. Full PSL deferred (docs/archive/PRD.md:341).

## Phase 3 candidates (NOT committed)

Captured 2026-05-19 so we do not re-derive. None of this is a commitment (docs/archive/PRD.md:349).

- **4-bucket policy model** (generalizes the 3-state): (a) logged-in first-party (password submit / OAuth callback / explicit marker) gives stable; (b) other first-party / 3p with history gives rotation; (c) user allowlist gives off; (d) no-history 3p over a FP-call-rate threshold gets farbled for the first N calls, then subsequent calls from that script ID are blocked. Allowlist ships empty; users curate (docs/archive/PRD.md:351).
- **Behavioral login detection** (`farblerLoggedIn`, survives cookie wipes): password-form submit, SSO/OAuth callback URLs, explicit "I have an account here" (docs/archive/PRD.md:352).
- **"Block" in bucket d** is per-call/per-script enforcement after observing N FP calls (throw `SecurityError`), not declarativeNetRequest (uBlock's lane). Defensible UX: "we measured them fingerprinting, you have no relationship, so we stopped them" (docs/archive/PRD.md:353).
- **Open questions:** empirically tune the FP-rate threshold (Stripe/reCAPTCHA/photo-editors vs FingerprintJS/creepjs); whether block-after-threshold itself becomes detectable (mitigate with delay + null/zeroed return mimicking permission denial); Worker-context bypass remains; cross-extension `farblerLoggedIn` sync deferred (docs/archive/PRD.md:354).

## Slice-plan history (all slices shipped)

- Work order was Slice 2 first (hard-part-first): Tier B seeded farbling + WebGL constants (10-step build order, "do not deviate without updating the PRD"). Then Slice 1 (Tier A coverage + per-origin model). Then Slice 3 (visibility layer + UX). Each independently shippable (docs/archive/PRD.md:358).
- Done-when gates and the numbered build order are preserved in git history of the PRD; all gates were satisfied per the progress tracker (see §9) (docs/archive/PRD.md:356-358).
