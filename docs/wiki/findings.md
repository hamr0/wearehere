---
title: Findings - what we can and can't do
slug: findings
gloss: Feasibility tiers, effectiveness ceiling, threat model
source: docs/archive/PRD.md
---

# Findings: what we can and can't do

An honest ceiling for the product, split into cookie classification limits, fingerprint farbling feasibility, and the differentiator (docs/archive/PRD.md:73-73).

## Cookie classification limits

- Can't beat opaque tracker IDs. Random or hashed names (`session_<uuid>`, vendor obfuscation) escape name matching; we catch the long tail of well-known patterns, not adversarial naming (docs/archive/PRD.md:77-77).
- Can't catch first-party-renamed trackers. If a site proxies Google Analytics and rewrites the cookie to `_session_id`, the list won't flag it. CNAME-cloak detection is out of scope (docs/archive/PRD.md:78-78).
- Can't classify session cookies meaningfully. Most are first-party auth, indistinguishable by name, so they are marked "session/auth" (docs/archive/PRD.md:79-79).
- Won't do cross-browser ID linkage. Detecting that `_ga` on site A equals site B requires parsing cookie values, which is out of threat model (docs/archive/PRD.md:80-80).

## Fingerprint farbling: feasible tiers

Feasible from an extension (docs/archive/PRD.md:84-84):

| Tier | Surfaces | Effort |
|---|---|---|
| A - Constants | `WebGL.getParameter` (UNMASKED_RENDERER/VENDOR), `navigator.hardwareConcurrency` to 4, `deviceMemory` to 8, `languages` to `['en-US','en']`, `screen.*` coarse buckets, `performance.now()` to 100µs precision | ~3-5 lines/surface, pure JS |
| B - Seeded farbling | `Canvas.toDataURL`/`getImageData`/`toBlob`/`readPixels`/`createImageBitmap` (low-bit pixel noise), `AudioBuffer.getChannelData` + `AnalyserNode.*` (low-amplitude noise), font enumeration cap via `measureText` | JShelter algorithm pattern (spec only, no source lift); HMAC-derived per-origin seed; ~300-500 lines |

(docs/archive/PRD.md:86-89)

## Not feasible from an extension (acknowledged ceiling)

(docs/archive/PRD.md:91-91)

| Limit | Why | Who beats it |
|---|---|---|
| Inline `<script>` before `document_start` | MAIN-world content scripts fire at the earliest extension-visible moment; ~2-5% of sites probe earlier | Brave (renderer-level C++) |
| TLS JA3/JA4, HTTP/2 settings-frame order | Below JS surface, set by OS network stack | OS-level changes |
| Real IP + ASN | Network layer | VPN/Tor |
| SVG-glyph bounding-box font enumeration | A determined fingerprinter renders into SVG; we blunt `measureText`, can't eliminate | Nobody fully |
| "User runs anti-fingerprint extension" meta-signal | Honest framing required | Brave (default for all its users) |
| Sandboxed iframes without `allow-scripts` | Chrome blocks all script execution (incl. content scripts) as a security boundary; `match_origin_as_fallback` resolves URL-match but cannot override the sandbox attribute. Browserleaks-style adversarial harnesses use exactly this. | Brave / Firefox RFP (renderer-level, below the sandbox) |
| OS-identity via UA client hints / UA string / Worker scope | `navigator.userAgentData.platform`, `navigator.userAgent`, Worker-global `navigator.*` all bypass main-thread `Object.defineProperty` wrappers. Spoofing only the main thread creates a cross-check detection signal (see `navigator.platform` revert, §8). | Brave / Firefox RFP |
| Commercial aggregate bot-detection (Akamai / PerimeterX / DataDome) | Probes many surfaces and blocks on any detected tampering; no single wrapper fix (Nike/Akamai finding, §8). | Brave (Shields-down per site) |
| Worker / OffscreenCanvas fingerprinting | Workers have their own globalThis; content-script wrappers don't reach them. Rare in mainstream FP libs (they query main-thread). | Brave / Firefox RFP |

(docs/archive/PRD.md:93-103)

## Effectiveness ceiling

- Realistic effectiveness ceiling is about 95-98%. We raise the cost of identification; we don't eliminate it (docs/archive/PRD.md:105-105).
- Randomization, not uniformity. The Safari/Firefox-RFP/Tor "everyone looks identical" model isn't achievable from an extension: we can't convincingly shrink real GPU/canvas entropy from JS without huge breakage and detectable lies. Randomization is the feasible lever at our layer (docs/archive/PRD.md:105-105).

## Threat model

- Farbling targets the commodity surveillance economy (FingerprintJS-class libraries that hash-and-join, no spoof-detection). There it reliably denies the cross-site/longitudinal join key (docs/archive/PRD.md:107-107).
- Against determined adversaries (bank fraud, Akamai-class anti-bot) it is detectable and routed around via un-farbled signals (IP, login, network layer). Those are not the threat model and get the `off`/relax escape hatch (docs/archive/PRD.md:107-107).

## The differentiator

Coverage parity with Brave/Firefox-RFP/JShelter is cheap, so there is no moat there (docs/archive/PRD.md:111-111). What nobody else packages:

- Per-origin three-state model (rotation / stable / pass-through) coupled to the cookie scoper's trust list, using the same UX vocabulary and no new learned concepts (docs/archive/PRD.md:112-112).
- Auto-pickup from cookie trust: a site marked "I live here" for cookies automatically gets stable farbling, with zero new UI for the common case (docs/archive/PRD.md:113-113).
- Visibility: per-site "N probes farbled" counters in popup and dashboard, same affordances as the scoper's tightened/killed counters (docs/archive/PRD.md:114-114).
- Default ON, with the cookie trust list as the auto-allowlist for logged-in sites (docs/archive/PRD.md:115-115).

## typesafe.ai turnstile_blocked: scoper wrote unpartitioned duplicates (2026-11-19)

1. Root cause: the cookie scoper re-set partitioned cookies via `cookies.set` without `partitionKey`, writing an unpartitioned duplicate (`cf_clearance` on `.typesafe.ai` alongside the partitioned one, topLevelSite `https://typesafe.ai`). Cloudflare Turnstile then rejected the login.
2. Proven by manual bisect in real Firefox: scoper-fix build (V1) passes, dev build fails, no-ext passes.
3. Fix (9d47c5a): scoper skips partitioned cookies (`partitionKey` / `firstPartyDomain`) and `WH_CHALLENGE_EXCLUDES` hosts, in both sweep and `onChanged`. A default rule, not a site list.
4. Trade-off: in Firefox (Total Cookie Protection) all third-party cookies are partitioned, so the scoper no longer trims any third-party cookie in FF. Low privacy cost (partitioned cookies can't track cross-site); FF trimmed counters drop.
5. Chrome: `getAll({})` doesn't return CHIPS cookies at all; only `onChanged` sees them. The duplicate bug is confirmed only in Firefox.
6. Open: an unpartitioned `__cf_bm` appears on typesafe whenever the extension is loaded, even with the scoper disabled; absent in no-ext runs. Not the cause of the login failure. Unexplained.

## Verification lesson: JS-layer parity is not login proof (2026-11-19)

- Zero page differences vs no-ext at the JS layer does not prove a login works; the extension also acts at the cookie/network layer. Verify with the real flow.
- When automation can't (Cloudflare WAF blocks Selenium even with no extension; the challenge only runs on submit), build per-component strip variants (scoper off / inject off / no content scripts) for the user to bisect by hand.
- Clear site cookies between runs; old corrupt cookies mask a fix.

## Remaining anti-bot breakage classes (2026-11-19)

- Untrusted site with captcha: captcha frame unwrapped but top page blurred, so the vendor may compare. Remedy: Trust ID.
- Anti-bot cookie misclassified as tracker: demoted to session, so re-challenge each session.
- First-party anti-bot cookies trimmed to 7d: re-challenge weekly, no duplicate written.
- First-party-routed challenge frames (`/cdn-cgi/challenge-platform` on the site itself) are not matched by the host list.

## vinted Firefox slowness: parked (2026-11-19)

- Method: Firefox Profiler, 3 rounds x 5 variants (no ext, release 5.0.0, dev, dev top-frame-only, dev blur off) on vinted catalog.
- Network/site variance dominates (no-ext grid visible 4.8-12.6 s). Dev not measurably worse than release. vinted's own CPU is 8-12 s/run vs extension 0.5-1.2 s.
- Extension hot spots: detect-played `scanCountdowns`/`Discounts`/`Scarcity` 400-700 ms/run (dev halved vs release); inject.js `farbleAnyCanvas` ~120-165 ms, only with blur on (FF blur works since fa6346c); detect-watched storage+HMAC ~25-48 ms; detect-cooked <30 ms dev (100 ms release).
- all-frames change: no measurable effect (3 frames).
- User reports it loads fine with AdGuard off and cache disabled, even with wearehere; likely AdGuard/cache interplay.
- Revisit only if Firefox's "wearehere is slowing down this page" banner recurs; note AdGuard state and page.
