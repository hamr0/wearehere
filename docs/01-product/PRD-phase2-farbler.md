# wearehere Phase 2 — Fingerprint Farbler (PRD)

> Status: in design. Branch: `phase2-fingerprint-farbler`. POC validated 2026-05-18 — storage→DOM→MAIN-world handshake works end-to-end on `navigator.hardwareConcurrency` (returned `4` on a real page after `chrome.storage.local.set({farbleDevMode: true})` + reload). Phase 2 lives inside wearehere; wearecooked phase 1 (cookie scoper) is already merged into wearehere as internal modules.
>
> **Mandatory rules:** all implementation work follows `.claude/memory/AGENT_RULES.md` — POC first, incremental modules, vanilla→stdlib→external dependency hierarchy, surgical changes, open-source only, mobile-responsive UI verified in DevTools before claiming UI tasks done. Never ship the POC — graduate, design, then build with tests.

## Why now

wearehere already wraps 8 fingerprint-relevant APIs in `inject.js` (MAIN world, `document_start`) for **notification only**. Phase 2 promotes selected wrappers from "log" to "lie" — substituting fake values at call-time, gated by a per-origin policy. This is the second intervention surface (cookie scoper was the first); the cost of adding it to the existing inject.js plumbing is much lower than building a new extension shell.

## What we can do — and what we can't

**Feasible from an extension (this PRD's scope):**

| Tier | Surfaces | Effort |
|---|---|---|
| **A — Constants** | `WebGL.getParameter` (UNMASKED_RENDERER/VENDOR), `navigator.hardwareConcurrency` → 4, `deviceMemory` → 8, `languages` → `['en-US','en']`, `platform` → `"Win32"`, `screen.*` coarse buckets, `performance.now()` → 100µs precision | ~3-5 lines per surface, pure JS, no seed plumbing |
| **B — Seeded farbling** | `Canvas.toDataURL` / `getImageData` (low-bit pixel noise), `AudioBuffer.getChannelData` (low-amplitude noise), font enumeration cap via `measureText` / `offsetWidth` | JShelter algorithm pattern; HMAC-derived deterministic per-origin seed; ~300-500 lines |

**Not feasible from an extension (acknowledged ceiling):**

| Limit | Why | Who beats this |
|---|---|---|
| Inline `<script>` in `<head>` before `document_start` | MAIN-world content scripts fire at the earliest extension-visible moment; pages can run inline JS before that. ~2-5% of sites probe early. | Brave (renderer-level C++ inside Blink) |
| TLS JA3/JA4 fingerprint | Set by OS network stack before request leaves; invisible to JS | OS-level changes |
| HTTP/2 settings-frame order | Below JS surface | OS-level changes |
| Real IP + ASN | Network-layer | VPN/Tor |
| SVG glyph bounding-box font enumeration | A determined fingerprinter renders into SVG and measures; we can blunt `measureText` but not eliminate | Nobody fully |
| "User runs anti-fingerprint extension" as a meta-signal | Honest framing required | Brave (it's the default for all Brave users) |
| Sandboxed iframes without `allow-scripts` | Chrome blocks all script injection (including content scripts) in such frames as a security boundary; not overridable from extensions. Surfaced by browserleaks/canvas's test harness. | Brave / Firefox RFP (renderer-level patching, below the sandbox layer) |
| OS-identity values exposed via UA client hints, UA string, or Worker scope | `navigator.userAgentData.platform`, `navigator.userAgent`, and Worker-global `navigator.platform` / `deviceMemory` / `hardwareConcurrency` all bypass our main-thread `Object.defineProperty` wrappers. Spoofing only the main-thread surface creates a cross-check detection signal. Surfaced by creepjs's multi-source platform report. | Brave / Firefox RFP (renderer-level patching, below where the surfaces diverge) |

**Realistic effectiveness ceiling: ~95-98%.** We raise the cost of identification; we don't eliminate it.

## What's unique to us (the differentiator)

Coverage parity with Brave/Firefox RFP/JShelter is cheap; no moat there. The packaged thing nobody offers:

- **Per-origin three-state model** (per-tab fresh / stable / pass-through) coupled to the cookie scoper's trust list — same UX vocabulary, no new learned concepts.
- **Auto-pickup from cookie trust list**: any site the user already marked "I live here" for cookies automatically gets stable farbling. Zero new UI for the common case.
- **Visibility surface**: per-site counter ("N fingerprint probes farbled on this site") in the popup and dashboard. Same affordances as the cookie scoper's tightened/killed counters.
- **Default ON** with the cookie trust list as the auto-allowlist for logged-in sites (revised from PRD-original default-OFF — see "Locked decisions" below).

## Locked decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Wrappers in scope | All 8 existing notify-only + add `WebGL.getParameter`, `deviceMemory`, `platform`, `screen.*`, `performance.now()` for Tier A; canvas + audio + fonts for Tier B | Aligns with PRD original Tier A/B split |
| 2 | Per-origin behavior model | Three states: per-tab farble (default), per-origin stable farble (cookie-trusted), real pass-through (manual allowlist) | Maps to "anonymous browsing" / "logged-in site" / "site that breaks under farbling" |
| 3 | Cookie trust list → stable farble linkage | **Automatic.** Site in `scoperTrust` → stable farble. No second toggle. | One mental model for the user; "I live here" = "consistent fake identity here" |
| 4 | Same fake across multiple logged-in sites? | **No — per-origin only.** seed = `HMAC(secret, origin)`. Each cookie-trusted site gets its own stable fake. | Cross-site uniform fake re-enables tracker merge (e.g., DoubleClick embedded on Reddit + bank). Per-origin stable kills cross-site merge even by embedded trackers. |
| 5 | Per-tab seed lifetime | **Dies on tab close.** Seed = `HMAC(secret, origin + tabNonce)`, tabNonce in `chrome.storage.session` keyed by `tabId+origin`. | Maximum exposure-per-tab minimization for anonymous browsing. New tab on the same untrusted site = new fake person. |
| 6 | Per-origin-stable seed storage | **None — derived.** seed = `HMAC(secret, origin)` computed at call-time. The secret persists; the origin is known; the seed needs no separate table. | Simplicity. No nonce management for trusted sites. |
| 7 | Global default | **ON.** Cookie trust list acts as auto-pass-through for logged-in sites. Manual allowlist for sites that break even with stable farble. | Matches scoper's "default-ON, escape hatch via trust list" — the same design pattern that made Phase 1 viable |
| 8 | Manual "force pass-through" allowlist | **Yes.** Separate from cookie trust list. Power-user surface. For sites where even stable farble trips anti-bot (banks fronted by aggressive Cloudflare Turnstile / DataDome). | Real escape hatch with measurable use case |
| 9 | "Force farble" override list (cookie-trusted but still farble) | **Skip.** Edge case; revisit if asked. | Not worth the UI surface day one |
| 10 | Tier B algorithm source | JShelter spec (algorithm only, no source lift). Brave farbling spec as cross-reference. | Algorithms are not copyrightable; JShelter is GPL-3 source — keep source out, lift spec only |
| 11 | Seed secret rotation | **Never rotates** after first generation. | Rotation would break the "stable fake identity on trusted sites" property |
| 12 | Storage namespace | `farblerSecret`, `farblerAllowlist`, `farblerStats`, `farblerSettings` in `chrome.storage.local`. Per-tab nonces in `chrome.storage.session`. | Same shape pattern as `scoper*` keys |

## Storage contract

```js
chrome.storage.local: {
  farblerSecret:     "<64-byte HMAC key, generated once on install>",
  farblerAllowlist:  { [etld1]: { addedAt: number } },     // "force pass-through here"
  farblerSettings:   { enabled: true },                    // global kill switch
  farblerStats: {
    farbled:    number,                                    // lifetime probes farbled
    passed:     number,                                    // lifetime probes passed through
    bySite:     { [etld1]: { farbled, passed, surfaces: { [api]: count } } }
  },
  // scoperTrust is read but not written by the farbler — proxies "stable farble" sites
}

chrome.storage.session: {
  farblerTabNonces:  { [tabId + "|" + etld1]: nonce }      // per-tab, dies with browser/session
}
```

## Decision flow at call-time

```
Page calls navigator.hardwareConcurrency
  → wrapper fires notify()                                  (telemetry, always)
  → wrapper reads data-wh-farble-state attribute on <html>
       written by detect-watched.js (ISOLATED, document_start) after
       reading chrome.storage.local + chrome.storage.session

  if state === "off"      → return real value
  if state === "stable"   → return fake derived from HMAC(secret, origin)
  if state === "per-tab"  → return fake derived from HMAC(secret, origin + tabNonce)
```

The DOM-attribute handshake was validated in POC (2026-05-18). MAIN-world wrapper reads attribute synchronously at call-time; ISOLATED-world write completes well before the page issues its first probe in practice.

## The three slices

Each slice is independently shippable and reviewable. Work order: **Slice 2 first** (hard-part-first; if Tier B isn't viable, Slice 1 and 3 are still useful but the headline privacy win fails).

### Slice 2 — Tier B seeded farbling + WebGL constants (hard part)

The load-bearing technical slice. Validates that JS-side seeded noise on canvas/audio/fonts works without unacceptable performance cost or anti-bot collisions. Also includes WebGL constant lies (`getParameter`) because we're wrapping WebGL anyway for `readPixels`.

**Modules:**
- `farble-seed.js` (ISOLATED, in `detect-watched.js`) — read secret + tabNonce + scoperTrust + farblerAllowlist → compute seed via HMAC-SHA256 → write `data-wh-farble-state` + `data-wh-farble-seed` on `<html>`
- `farble-canvas.js` (MAIN, in `inject.js`) — wrap `toDataURL`, `toBlob`, `getImageData`, `WebGL.readPixels`, `WebGL2.readPixels`, `createImageBitmap` (canvas-source). Skip canvases > 1024×1024. Perturbation: 100 pixels spread across canvas at seed-derived pseudo-random positions.
- `farble-webgl-getparameter.js` (MAIN, in `inject.js`) — return fixed strings for `UNMASKED_RENDERER_WEBGL` / `UNMASKED_VENDOR_WEBGL` when state ≠ "off"
- `farble-audio.js` (MAIN, in `inject.js`) — wrap `AudioBuffer.getChannelData`, `AnalyserNode.getFloat*Data/getByte*Data`. Perturb every Nth sample by ±0.0001 (Float) or ±1 (Byte).
- `farble-fonts.js` (MAIN, in `inject.js`) — wrap `CanvasRenderingContext2D.measureText`. Map any font-family to one of the 10 Win32 fonts; return canonical widths from a fixed table.
- Background SW — generate `farblerSecret` on `onInstalled` (once, idempotent), generate `tabNonce` on `tabs.onCreated`, clean up on `tabs.onRemoved`, respond to `runtime.sendMessage({type: "farbler:getNonce"})`.
- Manifest — add `matchOriginAsFallback: true` to both content_scripts entries.

**Done when:**
- HMAC seed derivation works in ISOLATED world (crypto.subtle available) and seed is delivered to MAIN via DOM attribute
- Canvas farbling: A/B test passes (OFF==OFF, ON==ON, OFF!=ON) for `toDataURL`, `getImageData`, `toBlob`, `readPixels`. Different origin → different hash. Visually-identical canvas.
- Audio farbling: same A/B property as canvas; perturbation inaudible at normal listening levels.
- Font cap: `measureText` returns one of N stable values; site-side font detection lists exactly the 10 curated fonts.
- WebGL constants: `getParameter(UNMASKED_RENDERER_WEBGL)` returns the fixed string when state ≠ "off".
- Sub-frame coverage: `matchOriginAsFallback` lets wrappers run in `about:blank` / `srcdoc` iframes. browserleaks's canvas hash differs from real.
- Performance: <2ms overhead per `toDataURL` call on a 1080p canvas; no measurable audio glitch; canvases > 1024×1024 skip farbling entirely.
- No breakage on a smoke-test set (5 sites: a news site, a banking-login *landing* page, a CAPTCHA challenge page, a canvas-heavy game/demo, a WebAudio demo).

**Build order (do NOT deviate without updating this PRD first):**

1. Migrate POC attribute: `data-wh-farble="on"` → `data-wh-farble-state="off|stable|per-tab"` + `data-wh-farble-seed="<hex>"`. Update both the writer (`detect-watched.js`) and the existing canvas wrapper. Re-run A/B test to confirm no regression.
2. Implement `farble-seed.js` in `detect-watched.js`: read secret from storage (or generate via background SW if missing), compute HMAC-SHA256(secret, origin) for stable mode, compute HMAC-SHA256(secret, origin + "|" + tabNonce) for per-tab mode, write attributes. Unit test: same input → same hex; different input → different hex.
3. Refactor existing canvas `toDataURL` wrapper to consume the new seed attribute (drop `pocSeed()`). Re-run A/B to confirm.
4. Add `farble-webgl-getparameter.js` (Tier A constants for WebGL renderer/vendor).
5. Extend `farble-canvas.js`: spread perturbation positions via seed-derived pseudo-random offsets (not regular stride). Add size gate (skip > 1024×1024). Add wrappers for `toBlob`, `readPixels` (both WebGL1 and WebGL2), `createImageBitmap` (canvas-source variants).
6. Add `farble-audio.js`: wrap `AudioBuffer.getChannelData`, `AnalyserNode.getFloat*Data/getByte*Data`.
7. Add `farble-fonts.js`: wrap `measureText` only (NOT `offsetWidth` — too many legit callers).
8. Background SW: secret generation + tabNonce plumbing + runtime message handler.
9. Manifest: add `matchOriginAsFallback: true` to inject.js and detect-watched.js content_scripts entries.
10. Real-site smoke test: browserleaks (canvas + webgl + audio + fonts pages) + amiunique + 3 normal sites. Document any breakage in the PRD progress tracker.

**Do NOT add in Slice 2 (defer to Slice 1 or later):**
- `navigator.hardwareConcurrency / deviceMemory / languages / platform` lies → Slice 1
- `screen.*` bucket lies → Slice 1
- `performance.now()` precision floor → Slice 1
- Per-origin allowlist UI → Slice 3
- Worker / OffscreenCanvas wrapping → out of scope v1 (acknowledged gap)
- `offsetWidth` font detection → out of scope v1 (false-positive risk)

### Slice 1 — Tier A coverage + per-origin model

Constants are trivial code; the work is the per-origin state model and the trust-list integration.

**Modules:**
- Promote remaining wrappers in `inject.js`: `WebGL.getParameter`, `navigator.languages/platform/deviceMemory`, `screen.*` (width, height, colorDepth, pixelDepth), `performance.now()` precision floor
- `farble-policy.js` (in background SW): given an origin, returns `"off" | "stable" | "per-tab"` based on `scoperTrust`, `farblerAllowlist`, `farblerSettings`
- Extend `detect-watched.js` handshake: write `data-wh-farble-state` instead of just `data-wh-farble`, derived from policy

**Done when:**
- All Tier A surfaces return canned values when state ≠ "off"
- Cookie-trusted sites correctly auto-map to "stable"
- Force-pass-through allowlist correctly maps to "off"
- Default (untrusted, not allowlisted) maps to "per-tab"
- Global kill switch (`farblerSettings.enabled === false`) maps all sites to "off"
- Unit tests for `farble-policy.js` cover all four cases

### Slice 3 — Visibility layer + UX

Counters and per-site UI. The detector data already exists in `detect-watched.js`; this slice surfaces it.

**Modules:**
- Extend `detect-watched.js` to split counts into `farbled` vs `passed` (read the state attribute, bucket accordingly)
- `farblerStats` accumulator in background SW (mirror of `scoperStats`)
- Popup "Fingerprint farbler" card — site line, "N probes farbled", per-site state toggle (per-tab / stable / off)
- Dashboard block alongside cookie scoper's blocks:
  - Hero: lifetime probes farbled + sites farbled + last activity
  - Force-pass-through allowlist table (parallel to trusted-sites table)
  - Settings: global kill switch

**Done when:**
- Per-site farbled count is correct against a controlled test page that probes a known number of surfaces
- Popup toggle correctly mutates the per-site state and survives a page reload
- Dashboard allowlist add/remove round-trips correctly
- All UI is responsive (verified in DevTools device emulation per AGENT_RULES)

## Out of scope for Phase 2

- CSS-based font enumeration defense beyond `measureText` (SVG-glyph bypass acknowledged, mitigation requires browser-level work)
- WebRTC IP leak (separate concern, separate intervention path)
- Sensor APIs (accelerometer, gyroscope) — low real-world fingerprint use, defer
- Battery API — removed from Chrome
- Cross-extension data sync — wearehere is the home; wearecooked is the testing bed

## Phase 3 candidates (not committed) — 2026-05-19

Surfaced during M3 testing strategy review. **These are future-phase ideas, not Phase 2 scope.** Captured here so the model is preserved and we don't re-derive it later.

### 4-bucket policy model

Generalization of locked decision #2 ("per-origin three-state model"). The three states (off / stable / per-tab) split into four buckets driven by **behavioral signals**, not user toggles:

| Bucket | Trigger | Farble mode | Rationale |
|---|---|---|---|
| **a. Logged-in first-party** | Password submit observed on origin, OR OAuth callback to origin, OR explicit user marker | **stable** (HMAC(secret, origin), persistent) | Site already knows you. Stable fingerprint avoids anti-fraud "different device every session" alarms (banks, brokerages, Stripe Radar). Existing Slice 1 stable mode. |
| **b. Other first-party / 3P with first-party history** | Origin appears in `visits.js` ring as a top-level visit | **per-tab** (HMAC(secret, origin + tabNonce), rotates on tab close) | No account relationship to preserve; correlation defeat is the win. Current default behavior. |
| **c. User allowlist** | User-added entry in `farblerAllowlist` | **off** (pass-through) | Stripe Radar / reCAPTCHA / some bot-detection scripts integrity-check canvas; farbling can break them. Allowlist ships **empty** — users curate. |
| **d. No-first-party-history 3P over threshold** | Origin never appeared in `visits.js`; AND single-script FP call rate > N calls/sec (initial guess: 50/1s) | **farble for first N calls → block subsequent calls from that script ID** | Adaptive escalation. By the time threshold trips, this is provably a fingerprinter, and user has no relationship to break. Surface in popup: "blocked X after Y calls." |

### Behavioral login detection (bucket a feeder)

Determining "user has account on origin" reliably without depending on cookies (user clears) or tab lifetime (varies wildly):

- **Signal 1: Password form submission.** Content script watches `submit` events on forms containing `<input type="password">`. Origin marked in `farblerLoggedIn` set in `chrome.storage.local`. High-confidence — submitting a password = real account.
- **Signal 2: OAuth callback URL.** Detect redirects from known SSO providers (`accounts.google.com`, `login.microsoftonline.com`, `github.com/login/oauth`, `appleid.apple.com`, etc.) back to a non-provider origin. The destination origin gets marked. Covers SSO/passwordless cases.
- **Signal 3: Explicit user marker.** Popup affordance "I have an account here." Catches edge cases (WebAuthn-only, magic-link email auth, internal company SSO providers we don't recognize).

`farblerLoggedIn` is a behavioral truth store, only mutated by these three signals + a user "remove" action. Survives cookie wipes. Independent of session state.

### What "block" actually means in bucket d

- **Not** declarativeNetRequest / blocklist-based — that's uBlock Origin's lane and reinventing it badly will tank adoption.
- **Yes** per-call, per-script enforcement *after* our wrapper observed N FP calls from that script. Throw `SecurityError` on subsequent calls. Wrapper already has `byScript` map (line 14 of `detect-watched.js` and `callerHost()` in `inject.js`) — the data exists.
- Surface in popup: per-script counter + block status. Defensible UX: "we measured them fingerprinting, you have no relationship, so we stopped them."

### Allowlist policy

- Ships **empty** by default. No curated entries.
- User adds entries through popup ("trust this site's fingerprint surface") or dashboard.
- Suggested-list link (community-maintained, e.g. uBlock-style) may appear in dashboard — never auto-applied. Aggressive positioning: "your decision who to trust."

### Open design questions for Phase 3

- How is the FP-rate threshold tuned empirically? Smoke-test across known-good (Stripe, reCAPTCHA, photo editors) and known-bad (FingerprintJS, ThumbmarkJS, creepjs) call patterns.
- Does block-after-threshold itself become a detectable signal? (Site sees `getImageData` throw after N successful calls.) Mitigation: same-call delay before throw + return `null` or zeroed ImageData on first throw to mimic permission denial.
- Worker-context fingerprinters bypass everything in bucket d (we don't reach Workers). Acknowledged gap, same as Slice 2.
- Cross-extension policy sync (wearehere ↔ wearecooked ↔ future) — `farblerLoggedIn` is potentially useful to other modules. Defer unless second consumer emerges.



## Resolved before Slice 2 (2026-05-18)

- **Font cap list**: **Single Win32-flavored list of ~10 common fonts** (Arial, Times New Roman, Courier New, Verdana, Georgia, Tahoma, Trebuchet MS, Comic Sans MS, Impact, Lucida Console). Pairs with `platform`=`Win32` lie for internal consistency — every farbled user looks like a Windows user with a standard font install. Maximum population blend; max/Linux users get a small consistency penalty if a site falls back to OS-specific font names, but webfont fallback chains absorb most cases.
- **`screen.*` buckets**: **Four buckets, snap-to-nearest:** 1366×768, 1920×1080, 2560×1440, 3840×2160. "Nearest" not "round-up" — a 1440×900 reports as 1366×768; a 3000×2000 reports as 2560×1440. Avoids both quality hits (don't lie down for 4K → low-res asset) and breakage on hard-coded breakpoints (don't lie up past common values).
- **`hardwareConcurrency` value**: **4.** Modal value across the web; max population blend. Lower numbers (2, 1) stand out more, not less.
- **Stable farble + embedded ad-tech on cookie-trusted sites**: per-origin stable means DoubleClick embedded on Gmail sees Gmail's seed; embedded on Reddit sees Reddit's seed. Different seeds, no cross-site merge — working as designed. Document in user-facing README so users understand the privacy property.

## Resolved during Slice 2 design (2026-05-19)

These extend / clarify the original locks above. They came out of the POC graduation review and explicitly do **not** get reopened.

- **How canvas fingerprints actually work (and what this means for noise volume)**: a canvas fingerprint is a SHA256 (or similar) hash of the bytes returned by `toDataURL` / `getImageData` / `readPixels`. Cryptographic hashes have the avalanche property — **any single byte change produces a completely unrelated hash**. There is no "more noise = more different hash"; 1-byte change and 100,000-byte change produce equally unrelated hashes. The real reasons to spread perturbation across many pixels are (a) robustness against fingerprinters that average multiple readings to filter out noise, and (b) robustness against fingerprinters that hash specific canvas regions instead of the whole output.
- **Performance gating on large canvases**: **skip farbling when canvas area > 1024×1024 pixels.** Reasoning: 4K canvases are almost never fingerprint vectors (fingerprinters use 200×50 to 500×100 for speed and small payloads). Skipping large canvases saves 30–50ms per call on legit use (image export, screenshot, video frame extraction) with effectively zero privacy loss — a fingerprinter who switches to a 4K canvas to evade us would also pay the 50ms cost on every reading, making the attack impractical.
- **Anti-averaging robustness on the 100 perturbed pixels**: spread the 100 perturbations at **seed-derived pseudo-random positions** across the canvas, not at fixed-stride positions. Same seed → same positions (deterministic per origin); different seed → different positions (per-origin uniqueness). One algorithm change from the POC, no perf cost.
- **Per-tab seed ships in v1, not v1.1**: distinct seeds per state, no shared nonce. Stable = `HMAC(secret, origin)`. Per-tab = `HMAC(secret, origin + "|" + tabNonce)`. Allowlist = no farbling. tabNonce generated in background SW on `tabs.onCreated`, stored in `chrome.storage.session` keyed by tabId, dropped on `tabs.onRemoved`. Detect-watched.js requests the nonce via `runtime.sendMessage` at content-script boot.
- **Worker / OffscreenCanvas coverage**: **skipped in v1.** Workers have their own globalThis; our content-script wrappers don't reach them. Wrapping the `Worker` constructor to patch source code is fragile and breaks sites. **Acknowledged gap**: a Worker-based fingerprinter (rare in practice — FingerprintJS, Adobe, Cloudflare bot detection use main-thread) would succeed against us. Document honestly in README.
- **`WebGL.getParameter` constant lies**: **included in Slice 2** (not Slice 1) because we're wrapping WebGL anyway for `readPixels`. Lies: `UNMASKED_RENDERER_WEBGL` → `"ANGLE (Intel, Intel(R) Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"`, `UNMASKED_VENDOR_WEBGL` → `"Google Inc. (Intel)"`. Other Tier A surfaces (`navigator.*`, `screen.*`, `performance.now()`) stay in Slice 1 — independent wrappers, not wrap-while-we're-here.
- **Migrate attribute contract during Slice 2**: replace POC's binary `data-wh-farble="on"` with **`data-wh-farble-state` = `"off" | "stable" | "per-tab"`** plus **`data-wh-farble-seed` = hex-encoded 4 bytes**. Wrappers check `state !== "off"` to decide whether to farble. Slice 1's policy module writes the state and seed; Slice 2's wrappers read them.
- **Sub-frame injection (`about:blank` / `srcdoc` / `data:` iframes)**: use **`matchOriginAsFallback: true`** in manifest `content_scripts` (Chrome 105+). Iframe inherits parent origin → our `<all_urls>` match applies via fallback. Cleaner than `chrome.scripting.executeScript` from background.

## Resolved during Slice 2 build (2026-05-19)

Findings from the build prep (Module 0 — DEBUG gating + verification on creepjs / browserleaks). Do not reopen without revisiting the test transcripts.

- **Real-world canvas-readback call volume is much higher than expected.** Creepjs (`abrahamjuliot.github.io/creepjs`) triggers ~150 `getImageData` calls per page load — the bulk are from the `fonts`, `rects`, `svg`, and `emoji` sub-tests, not the named `canvas 2d` test (which only contributes 1–2 `toDataURL` calls). Implication: the performance budget in Slice 2's done-when list (`<2ms overhead per toDataURL on a 1080p canvas`) is necessary but not sufficient — we must also stay cheap on the **small-canvas hot path** (50×20 font samples, hit 150× per page). Mitigations:
  - Existing upper gate (skip canvases > 1024×1024) stays.
  - **Add a lower gate in Slice 2 step 5: skip canvases with total area < 1024 pixels** (32×32 boundary). Font-detection probes are unfingerprintable on their own — they only matter aggregated, and the aggregate is already perturbed via the larger canvas hashes elsewhere. Avoids burning ~150× per-call overhead on probes that have no real privacy value. **Threshold calibrated down from initial 4096 during M4.3 implementation:** M4.1 testing on creepjs showed the *primary* canvas 2d fingerprint test uses 40×40 (1,600 px) and 50×50 (2,500 px) canvases — both below 4096, both real fingerprint vectors. 1024 floor passes 32×32+ while still gating the 1×1, 2×2, 8×8 font/rect/svg probes that were the original motivation.
  - Measure the small-canvas hot-path explicitly in the perf check, not just one 1080p call.
- **DEBUG-gating pattern locked for all wrappers.** Every diagnostic `console.log` is wrapped `DEBUG && console.log(...)`, with `var DEBUG = false;` at the IIFE top of each content script. Flip to `true` and reload the extension to surface logs. Rationale: wrappers fire on every canvas/WebGL/audio call (150+ calls per page on creepjs); ungated logs flood real-page consoles. Use the same pattern in `farble-audio.js`, `farble-fonts.js`, and the seed module.
- **`farble-seed.js` physical layout: inline in `detect-watched.js` under a comment-delimited section, not a separate file.** Rationale: HMAC-SHA256 from `crypto.subtle` is ~30 lines; a separate file adds a manifest entry and a content-script ordering concern with no benefit at this size. Revisit if the seed module grows past ~100 lines or needs unit-testing in isolation.
- **WebGL canvas readback bypasses farbling — fix during step 5.** Surfaced by creepjs logs: every call to `toDataURL`/`toBlob` on a `webgl`/`webgl2` canvas hits our wrapper, but `farbleCanvas2D` returns null (`getContext("2d")` fails — canvases can only hold one context type), so the real bytes pass through. PRD step 5 already lists `readPixels` wrappers, but those only catch direct framebuffer reads; `toDataURL` on a WebGL canvas internally encodes the framebuffer without going through `readPixels`. **Step 5 must also generalize `farbleCanvas2D` to a `farbleAnyCanvas(src, seed)` that uses `drawImage(src, 0, 0)` onto a fresh 2D offscreen canvas — that path works uniformly for 2D and WebGL sources and lets the existing perturb→putImageData→toDataURL flow apply.**
- **First-ever-install race (step 2 finding, fix folded into step 8).** When `farblerSecret` is missing from `chrome.storage.local`, `detect-watched.js` does the inline bootstrap: `crypto.getRandomValues` + `chrome.storage.local.set` + `crypto.subtle.sign(HMAC)`. On the *first ever* navigation after a wipe this chain loses the race against early page probes — measured 9 leaked `state=off` canvas readbacks on creepjs (out of ~141 total) before the attribute landed. After the first run, the secret is cached in storage and subsequent navigations win cleanly (verified across 3 follow-up reloads including new-origin and post-wipe re-bootstrap cases). **Step 8 fix: move secret generation into the background SW's `onInstalled` handler so the content script never has to bootstrap. That collapses the content-script async chain to one `storage.local.get` + HMAC, which Test 3/4 already demonstrated wins the race even on bootstrap-adjacent timings.** We accept the narrow first-install leak as a known gap for steps 2–7 and verify it's gone by step 8's done-when.
- **PRD step 9 advanced out-of-order (`match_origin_as_fallback`) — done 2026-05-19.** Surfaced by a "why doesn't browserleaks show wrapper activity?" question during M3 testing. Cause: browserleaks's canvas/webgl/audio test harness runs each surface inside an `about:blank` (or `srcdoc`) iframe; Chrome's content-script matcher doesn't match `<all_urls>` against `about:blank`, so our scripts never inject and the iframe runs unwrapped APIs. Standard plan was to flip `match_origin_as_fallback: true` at step 9 after all wrappers ship. **Decision: flip it now (right after M3) so every subsequent module is tested with iframe coverage in place** — gives us cleaner per-surface signal from browserleaks instead of waiting until step 10 to find out which wrappers had iframe-specific issues. Scope-limited: only `inject.js` and `detect-watched.js` get the fallback; the other 7 `detect-*.js` content scripts stay top-level-only to avoid unintended scope expansion. Risk accepted: rare sites using sandboxed iframes might see unexpected injection; mitigated by being in dev/test (no users) and the wrappers being notify+farble-only (no UI/breakage surface).
- **Sandboxed-iframe ceiling (real-world test finding, 2026-05-19) — acknowledged unfarble-able.** Browserleaks's canvas/WebGL/audio test pages run their probes inside `<iframe sandbox="...">` **without `allow-scripts`**. Chrome enforces the sandbox by blocking ALL script execution in the frame — including content scripts — and logs `Blocked script execution in 'about:blank' because the document's frame is sandboxed and the 'allow-scripts' permission is not set`. `match_origin_as_fallback` resolves the URL-match step but cannot override the sandbox attribute (security boundary set by parent page, enforced by renderer regardless of extension permissions). **Implication: browserleaks-style adversarial test harnesses cannot be farbled by ANY content-script extension. Add to "Not feasible from an extension" table.** Brave/Firefox RFP defeat this because they patch APIs inside the renderer (below the sandbox layer). Honest framing in README required.
- **Receiver-guard pattern locked for all canvas/context wrappers (M4.1 finding, 2026-05-19).** creepjs probes for extension instrumentation by calling prototype methods with a non-canvas receiver (e.g. `HTMLCanvasElement.prototype.toBlob.call(plainObject)`). On a non-instrumented browser this throws `TypeError: Illegal invocation` immediately, with zero side effects. Our wrappers were doing `notify()`, debug-logging "toBlob called", and then calling `farbleAnyCanvas` which failed inside `drawImage` and logged `drawImage failed: ...` — all of which is observable to the page via `console.log` polling or message-event listeners. **Fix locked: brand-true receiver guard at the top of every wrapper.** `function isCanvas(x) { return Object.prototype.toString.call(x) === "[object HTMLCanvasElement]"; }` and equivalents for `CanvasRenderingContext2D`, `WebGLRenderingContext`, `WebGL2RenderingContext`, `AudioBuffer`, `AnalyserNode`, etc. If guard fails, call `original.apply(this, arguments)` directly with no logging, no notify, no farbling — bit-for-bit identical to native. Cross-realm safe (Object.prototype.toString brand survives iframe boundaries). **Apply this pattern to every new wrapper in Slice 2 (M4.2/4.4/4.5, audio, fonts) and Slice 1 (Tier A surfaces).** Tier A property getters (`navigator.hardwareConcurrency` etc.) are auto-protected — they're property descriptors not prototype methods, so the "wrong receiver" probe doesn't apply.
- **creepjs WebGL readPixels with fractional dimensions (2026-05-19) — gated correctly, no action.** Surfaced during M8 verification: creepjs calls `gl.readPixels(0, 0, 17.066…, 42.666…, …)` in one of its WebGL sub-tests (likely a DPR-scaled screen-region probe). Native `readPixels` truncates to integer dimensions internally and fills the buffer with real bytes. Our M4.4 wrapper checks `withinFarbleSize(width, height)` with the floating-point args; `17.07 × 42.67 ≈ 728 px < FARBLE_MIN_PIXELS (1024)` so it gates correctly via the existing lower-bound path. **No code change needed** — the gate was already designed to handle small reads, fractional dimensions naturally fall under it. Worth documenting because the area computation `(w >>> 0) * (h >>> 0)` does coerce floats to uint32 (`17.066… → 17`), but this still produces `17 × 42 = 714` which is also below the gate — both paths converge to the right answer.
- **`willReadFrequently` console warning (2026-05-19) — benign, not actionable from our code.** Chrome's renderer logs `Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true` when a canvas's 2D context was created without that flag and then sees repeated `getImageData` calls. Stack trace points to creepjs's own canvas-creation site (`creep.js:3232`), not our wrapper. The flag is set at `getContext("2d", {willReadFrequently: true})` time and is immutable thereafter; since we don't create the source canvas, we can't change it. Our `farbleCanvas2D` does add one extra readback per wrapped call, which marginally amplifies the warning's truthfulness, but the renderer keys the message to the canvas's creator. **Action: none.** The warning has been present in every test log from M0 onward; only flagged now because it surfaced during deeper inspection. Lower size gate (M4.3) will reduce overall readback volume on font-detection probes, indirectly trimming the cases where the warning fires — but the warning itself stays.
- **WeakMap dedup pattern for mutable-reference returns (M5 finding, 2026-05-19).** `AudioBuffer.prototype.getChannelData` returns a *reference* to the buffer's underlying `Float32Array` — the native behavior is "same channel → same reference → identical bytes on every read." Our audio wrapper uses additive noise (`±0.0001`, not XOR), so without dedup a fingerprinter could call `getChannelData(0)` twice and observe the noise accumulating between the two reads (first read shifted by +0.0001 at some sample, second read shifted by +0.0002 at the same sample) — a clean detection signal. **Fix: `WeakMap<AudioBuffer, Set<channelIndex>>`** — on first call for a (buffer, channel) pair, perturb and add to set; on subsequent calls return the same already-perturbed reference. Matches native ref-equality semantics. **General rule: any wrapper that returns a reference to mutable internal state AND uses non-self-cancelling perturbation needs this pattern.** XOR-based byte perturbations self-cancel on repeated application at the same positions, so the canvas wrappers don't need it (and would actually break if we added it — see POC bug-class #2). Future surfaces to watch: `OffscreenCanvas.getContext`, any caching/memoizing API returning a typed-array ref. AnalyserNode methods fill caller-owned buffers each call, so no dedup needed there.
- **"API corrupted" count rises monotonically as wrappers ship — acknowledged ceiling (M5 finding, 2026-05-19).** creepjs's footer line reports `N API properties analyzed (K corrupted)` where K counts prototype methods whose source code doesn't match native. Pre-M4.x: 9 corrupted. After M5: 14 corrupted (the +5 = `AudioBuffer.getChannelData` + 4× `AnalyserNode.{getFloat,getByte}{Frequency,TimeDomain}Data`). K rises every time we wrap another surface. **This is the cost of wrapping, not a bug** — Brave and Firefox RFP show the same elevated `corrupted` count for the surfaces they patch. A zero-`corrupted` defense would require renderer-level patching (out of extension reach). Acknowledged in the "Realistic effectiveness ceiling" framing at the top of this PRD; surfacing here too because the number will keep climbing through M6 (measureText) and Slice 1 (Tier A constants), and a future reader inspecting creepjs results should not mistake it for a regression.
- **`navigator.platform` cross-surface inconsistency — reverted (Slice 1 finding, 2026-05-19).** Initial Slice 1 build spoofed `navigator.platform` to `"Win32"`. creepjs reads platform from **three** surfaces and reports them side-by-side: (a) main-thread `navigator.platform` — patchable, (b) `navigator.userAgentData.platform` (UA client hints) — **not** patchable from a content-script (modifying `userAgentData` is messy and Chrome's anti-tamper protections push back), (c) Worker scope `navigator.platform` — content scripts don't run in Worker globals. With (a) lying `"Win32"` and (b)+(c) returning `"Linux"`, a fingerprinter cross-checks the three and sees the disagreement as a strong "user runs a platform-spoofing extension" signal. **Net effect: we made ourselves MORE identifiable, not less.** Brave hit the same conclusion in 2020 and stopped spoofing `navigator.platform` for the same reason; only Firefox RFP can hold the line because it patches in the renderer, below where UAch + Worker globals diverge. **Resolution: revert `navigator.platform` to notify-only — the dashboard counter still surfaces reads, but no lie.** Worker-scope leakage of `deviceMemory` and `hardwareConcurrency` is the same class of gap (UAch doesn't expose either, but Worker `navigator.*` does); both kept for now because mainstream FP libraries query main-thread, not Worker. **Pattern lock for any future Tier A wrapper:** before farbling a constant, audit whether the same value is exposed via UAch, UA string, or Worker scope. If yes, either patch all surfaces (out of reach for us) or don't farble — partial spoofing is anti-defense. Adds a new row to the "Not feasible from an extension" table at the top of this PRD covering "UAch / Worker / UA string identity values."

## Resolved during Slice 3 — compat + per-site relax (2026-05-20)

- **Per-surface disable infra shipped (`famState`).** `inject.js` routes every wrapper's state read through `famState(fam)` = `famDisabled(fam) ? "off" : farbleState()`, where `famDisabled` reads a new `data-wh-farble-disable` attribute on `<html>` (comma-joined family list: `canvas|webgl|audio|fonts|screennav`). `detect-watched.js` writes it from a `farbleDisableFamilies` storage key. Built first as a **diagnostic** (isolate which surface breaks a site via the SW console) but kept as the **foundation for per-site surface relaxing** — the same path can be driven per-eTLD+1 instead of globally. Family names don't substring-collide, so `indexOf` is a safe membership test. Reuses every wrapper's existing `"off"` path, so no per-call logic changed.
- **Anti-bot aggregate tamper detection is unfarble-able per-surface (Nike / Akamai, 2026-05-20).** nike.com (Akamai Bot Manager) hangs on a spinner + ghost frames under blur; only full Trust ID (all surfaces off) loads it. **Empirically isolated:** disabling each family *individually* (`fonts`, `webgl`, `canvas`, `audio`) via `farbleDisableFamilies` did **not** fix it; disabling **all five** did. So no single wrapper is the offender — Akamai probes multiple surfaces and blocks on *any* detected tampering. **Implication: hardening one wrapper cannot fix this class of site.** Confirmed no wrapper throws (all guarded); the failure is a *block/hang*, not an exception. Mitigation is relaxing the whole site, not a surface. Add "commercial aggregate bot-detection (Akamai/PerimeterX/DataDome)" to the realistic-ceiling framing — same conclusion Brave reached (Shields-down per site).
- **Auto-detect of farble-broken pages rejected; shipped rage-reload → popup offer instead (2026-05-20).** First explored a causal in-page watchdog (LCP/spinner/text heuristics → reload-with-farbling-off A/B). **Abandoned — unreliable:** nothing in-page cleanly separates a hydrated SPA from a stuck skeleton (placeholder blocks register LCP; nav text defeats text thresholds; spinners are arbitrary/custom), browser load events fire while the page is still stuck (`load` ≠ rendered), and Akamai-class sites tear down our content-script context mid-spin so any in-page timer is fragile. **Shipped instead:** the *human* is the sensor — a user hammering reload on a broken page is the reliable signal. `background.js` writes `farbleReloadOffer[etld1]` from two SW-level signals (both survive content-script teardown): `chrome.tabs.onUpdated` showing **≥2 loads** of the same URL within 25s (initial + 1 reload) while blur is on, and a main-frame **403** in `webRequest.onCompleted` (an outright bot block — catches sites that block rather than hang; 429/rate-limit is excluded as usually transient and unrelated to blur). An **in-page top banner** (wearehere colors, shadow-DOM + CSSOM-set styles so it's page-CSS-isolated and CSP-safe, top frame only, reacting to `storage.onChanged` so it appears on the current stuck load) offers one-click **relax & reload**. **Persist + reload (and dismiss) route through the service worker** (`wh-relax-site` → SW sets `farblerSettings[etld1] = {mode:"off", auto:true}`, clears the offer, `chrome.tabs.reload`; `wh-clear-relax-offer` for the ✕): doing it page-side was the original bug — anti-bot sites detach the banner's content-script context right after it renders, so its own `chrome.storage` callback (which gated the reload) never fired and the click silently did nothing. The banner dismisses synchronously; the page reloads itself only when the SW is unreachable (dead context), else it trusts the SW reload with a 3s backstop. If the relax couldn't persist (dead context), a fresh content script re-shows the still-pending offer for a second click. The banner is primary because a multi-extension user won't think to open our toolbar popup; the popup is the fallback (a hint that highlights the existing Trust ID button — no duplicate action). One click = consent, so a false trigger is harmless. Pairs with a future **curated default-relax list** (seed: nike.com) for the biggest offenders so common cases never hit the wall. Tuning knobs: `RELAX_MIN_LOADS`, `RELAX_WINDOW_MS`.
- **`measureText` returns all-zero bounding boxes — correctness bug to fix (2026-05-20).** `fakeTextMetrics(width)` sets `width` real but every bounding-box field (`actualBoundingBoxAscent`/`Descent`, `fontBoundingBox*`, `emHeight*`) to `0`. Layout/measure code dividing by ascent/line-height gets `NaN`/`Infinity` → zero-height frames. Independent of Nike (not the Akamai cause, since disabling `fonts` alone didn't fix it), but a real breakage risk on other sites. **Fix: return plausible non-zero metrics derived from font size** (ascent ≈ 0.8×size, descent ≈ 0.2×size) while keeping the canonical per-bucket `width` (font-enumeration defense intact).
- **Seed-scope model: weekly rotation per origin; `per-tab` dropped (2026-05-20).** Audit found the shipped `per-tab` mode was an **unwired stub** — its tab nonce was a hardcoded placeholder, so `per-tab` and `stable` were both just persistent-per-origin seeds, differing only by a constant. Reframed around the actual goal (cross-site *and* longitudinal unlinkability). A permanent per-origin seed is itself a problem: it's a durable pseudonymous fingerprint — a stable tracking handle we mint and hand over — that defeats cross-site joins but not profiling **over time**. Shipped model: **`off` / `rotation` (default) / `stable`**. `rotation` folds a SW-managed salt into the label (`rotation|<salt>|<origin>`) that regenerates on a **7-day window** (`bootstrapFarbleSalt`, single-writer in the SW, content script fails safe to `off` if absent) — stable within a window, unlinkable across windows. Rotation is **time-keyed, not browser-session-keyed**, deliberately: tab groups / session-restore mean browsers rarely close, so a `chrome.storage.session` salt would be effectively permanent for most users. `stable` keeps the persistent-per-origin seed as a **per-site pin** for frequently-logged-in sites, where rotation buys nothing (already identified by login) and only adds "new device" re-auth friction; it's strictly better there than `off`, which leaks the *real* fingerprint. **Threat-model honesty:** farbling targets the commodity surveillance economy (FingerprintJS-class libraries that hash-and-join, no spoof-detection) — there it reliably denies the cross-site/longitudinal join key. Against determined adversaries (bank fraud, Akamai-class anti-bot) it's detectable and routed around via un-farbled signals (IP, login, network-layer); those aren't the threat model and get the `off`/relax escape hatch. Uniformity (Safari/Firefox-RFP/Tor model) isn't achievable from an extension — we can't convincingly shrink real GPU/canvas entropy from JS without huge breakage and detectable lies (cf. the `navigator.platform` revert) — so randomization is the feasible lever at our layer. `inject.js` `farbleState()` whitelists `stable|rotation`; legacy `per-tab` settings fold to `rotation`.

## POC bug-class to NEVER reintroduce

These bit us during Slice 2 POC. Wrapping any new API must avoid them.

1. **Dual injection**: don't inject `inject.js` from both `manifest.json` AND a dynamic `<script>` tag in a content script. Double-wrapping each prototype method causes XOR-based perturbations to cancel themselves (same seed, same byte offsets, XOR twice = back to original). Manifest static injection is the canonical path.
2. **Self-recursion through wrappers**: any internal use of a wrapped API (e.g. `farbleCanvas2D` calling `ctx.getImageData()`) hits our own wrapper and double-perturbs with the same seed → same cancellation. **Always capture the original API reference at IIFE top** (`var ORIG_GET_IMAGE_DATA = CanvasRenderingContext2D.prototype.getImageData;`) and use the captured ref inside our own farbling code.
3. **Async storage race vs. wrapper install**: wrappers install at `document_start`; storage reads are async. Read the seed/state attribute **at call-time** (not install-time) so the async handshake has until the first probe to land. POC validated this works in practice (storage round-trip completes well before any page-issued probe).

## Progress tracker

Updated as work lands.

| Item | State | Notes |
|---|---|---|
| Branch cut | ✅ done 2026-05-18 | `phase2-fingerprint-farbler` off wearehere main `a6e61dd` |
| POC: storage→DOM→MAIN handshake on hardwareConcurrency | ✅ done 2026-05-18 | Returned `4` after flag flip + page reload. Confirmed `data-wh-farble === "on"` round-trip. |
| PRD locked | ✅ done 2026-05-18 | This document |
| Slice 2: Tier B seeded farbling — POC | ✅ graduated 2026-05-19 | A/B verified on synthetic 2D canvas: same canvas content + `toDataURL` returns identical bytes with farble off (OFF==OFF), identical bytes with farble on (ON==ON), and **different bytes between off and on** (OFF!=ON). Two recursion bugs found and fixed along the way: (1) dual-injection in `detect-watched.js` double-wrapped APIs, XOR cancelled itself — fixed by removing dynamic `<script>` injection; (2) `farbleCanvas2D` called wrapped `getImageData` internally, perturbing twice with same seed → XOR cancellation — fixed by capturing `ORIG_GET_IMAGE_DATA` at IIFE top. Manifest `all_frames` flipped to `true` for iframe coverage. Per-origin deterministic seed via FNV-1a from hostname (placeholder for HMAC-SHA256). |
| Slice 2: Tier B seeded farbling — proper implementation | ⏳ design locked 2026-05-19, ready to build | See Slice 2 section "Build order" — 10 numbered steps, do not deviate without updating this PRD. Includes WebGL `getParameter` constants. Sub-frame via `matchOriginAsFallback`. Skips canvases > 1024×1024 and Worker contexts (acknowledged gap). |
| Slice 2 prep (Module 0): DEBUG-gate diagnostic logs | ✅ done 2026-05-19 | `var DEBUG = false;` at IIFE top of both `inject.js` and `detect-watched.js`; all 12 `[wh-farble]` / `[wh-farble:dw]` logs wrapped `DEBUG && console.log(...)`. Verified silent at false; verified flood at true on creepjs (~150 `getImageData` calls observed — see Resolved during Slice 2 build). |
| Slice 2 step 1 (Module 1): attribute contract migration | ✅ done 2026-05-19 | `data-wh-farble="on"` retired; writer (`detect-watched.js`) emits `data-wh-farble-state` + `data-wh-farble-seed`; reader (`inject.js`) consumes both via `farbleState()` / `farbleSeed()` helpers. All 4 call sites (toDataURL, toBlob, getImageData, hardwareConcurrency) migrated. A/B regression re-verified on creepjs: `HASH_OFF_1 == HASH_OFF_2`, `HASH_ON_1 == HASH_ON_2`, `HASH_OFF != HASH_ON`. `pocSeed()` deleted. |
| Slice 2 step 2 (Module 2): HMAC-SHA256 seed | ✅ done 2026-05-19 | `computeSeedHex` (FNV-1a) replaced with `hmacSeed8(secret, label)` in `detect-watched.js`. `getOrBootstrapSecret()` reads `farblerSecret` from `chrome.storage.local`, generates 64-byte fresh secret + persists if missing. Label = `"per-tab\|origin\|<PLACEHOLDER_TABNONCE>"` until step 8 wires a real nonce. **Verified:** determinism (A1==A2), per-origin uniqueness (A1≠B), secret-keyed (A1≠A3 after wipe). **Known timing gap on first-ever bootstrap** — see "Resolved during Slice 2 build". Fix folded into step 8. |
| Slice 2 step 3 (Module 1.5): wrapper consumes new seed attribute | ✅ folded into Module 1 | Already done as part of attribute contract migration: `pocSeed()` deleted, `farbleSeed()` reads from `data-wh-farble-seed`, A/B re-verified with both FNV (M1) and HMAC (M2) seeds. |
| Slice 2 step 4 (Module 3): WebGL `getParameter` constant lies | ✅ done 2026-05-19 | `wrapGetParameter()` helper covers both `WebGLRenderingContext.prototype` and `WebGL2RenderingContext.prototype`. Returns `"Google Inc. (Intel)"` for `UNMASKED_VENDOR_WEBGL` (0x9245) and `"ANGLE (Intel, Intel(R) Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)"` for `UNMASKED_RENDERER_WEBGL` (0x9246) when `farbleState() !== "off"`. All other `pname` queries pass through. Verified on Linux/Mesa box: real renderer `'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620…OpenGL ES 3.2)'` farbled to `'ANGLE (Intel, Intel(R) Iris Xe…D3D11)'`. |
| Slice 2 step 9 (Module 3.5): `match_origin_as_fallback` | ✅ done 2026-05-19 | Advanced out-of-order to right after step 4 — see "Resolved during Slice 2 build" for rationale. Scope-limited to `inject.js` + `detect-watched.js` only. Unlocks iframe coverage on browserleaks-style harnesses. |
| Slice 2 step 5a (Module 4.1): `farbleCanvas2D` → `farbleAnyCanvas` | ✅ done 2026-05-19 | Generalized via `drawImage(src, 0, 0)` onto fresh offscreen 2D canvas — covers 2D, WebGL, WebGL2 sources uniformly. Verified on creepjs: WebGL `toDataURL`/`toBlob` calls that previously logged `no 2d ctx` now produce `canvas 300x150 seed=<hex> flipped=450 pixels`. Offscreen ctx uses `willReadFrequently: true`. **Receiver-guard added in same module:** `Object.prototype.toString` brand-true check at the top of `toDataURL`, `toBlob`, `getImageData` wrappers — non-canvas probes (e.g. `HTMLCanvasElement.prototype.toBlob.call({})` from creepjs's extension-detection harness) bypass our logic entirely and fall straight to original (which throws native `TypeError: Illegal invocation`). Cross-realm safe. Eliminated 6 spurious `drawImage failed` log lines per page load that were themselves a faint extension-detection signal. |
| Slice 2 step 5b (Module 4.3): size gates | ✅ done 2026-05-19 | `withinFarbleSize(w, h)` gate applied in both `farbleAnyCanvas` (toDataURL/toBlob path) and `perturbImageData` (getImageData path). Bounds: `FARBLE_MIN_PIXELS=1024` (32×32) and `FARBLE_MAX_PIXELS=1048576` (1024×1024). Lower bound calibrated down from PRD's initial 4096 after M4.1 logs showed creepjs's canvas 2d test uses 40×40 (1600 px) and 50×50 (2500 px) — both real fingerprint vectors that must stay above gate. 1024 still skips all 1×1 / 2×2 / 8×8 font-detection probes (the original motivation). Verified on creepjs: 130 gate-skip logs (was 100+ wasted `perturbed 1x1 flipped=0` lines per run); 40×40, 50×50, 75×75, 300×150 all still farbled correctly; loose fingerprint still differs per tab. |
| Slice 2 step 5c (Module 4.4): `readPixels` wrappers (WebGL1 + WebGL2) | ✅ done 2026-05-19 | `wrapReadPixels(proto, label, brand)` helper applied to both `WebGLRenderingContext.prototype` and `WebGL2RenderingContext.prototype`. Brand-true receiver guard via `Object.prototype.toString` (mirrors M4.1 canvas pattern). Constraints: only farbles when `format === GL_RGBA (0x1908)` and `type === GL_UNSIGNED_BYTE (0x1401)` — applyFarble's 4-byte stride assumes that layout. Other formats (RGB/3-byte, FLOAT/16-byte, HALF_FLOAT, INT) and the WebGL2 PIXEL_PACK_BUFFER offset variant (7th arg = GLintptr instead of buffer) skip silently. Size-gated via `withinFarbleSize(width, height)`. **Verified end-to-end with byte-level diff scan:** 100×100 `gl.clearColor(0.5, 0.5, 0.5, 1)` framebuffer read back with seed `3f7a164d` produced exactly **300 perturbed bytes** (100 pixels × 3 RGB channels, alpha untouched) at offsets `36, 37, 38, 436, 437, 438, 836, …` matching `((seed % 100) * 4) + stride*N` — algorithm correct, alpha preserved, no overshoot, no undershoot. WebGL2 path verified separately. Negative tests: format=RGB and PIXEL_PACK_BUFFER variants emit `skip` logs without perturbing. |
| Slice 2 step 5d (Module 4.5): `createImageBitmap` wrapper | ✅ done 2026-05-19 | Wraps the global `window.createImageBitmap`. Only intervenes when first argument is a canvas source (`isCanvas` for HTMLCanvasElement OR `isOffscreenCanvas` for OffscreenCanvas — both brand-true via `Object.prototype.toString`). Other source types (Blob, ImageData, HTMLImageElement, HTMLVideoElement, ImageBitmap, SVGImageElement, VideoFrame) pass through unwrapped — they're either unrelated to canvas fingerprinting or already covered by other wrappers. When the source matches: farbles via `farbleAnyCanvas`, then swaps `args[0]` to the farbled offscreen and forwards to original — all subsequent createImageBitmap args (sx/sy/sw/sh cropping, options) preserved by `Array.prototype.slice`. Note: `createImageBitmap` is a window-level function, not a prototype method, so the canvas-wrappers' `this`-receiver guard pattern doesn't apply — we instead check the first argument's brand. Closes the third common WebGL/canvas extraction path (after toDataURL/toBlob and readPixels) used by FingerprintJS Pro and similar. **Verified end-to-end with byte-level diff scan:** 100×100 `fillRect rgb(128,128,128)` source canvas → createImageBitmap(src) → drawImage(bmp) into verify canvas → getImageData (with state attribute manually flipped to "off" to avoid double-perturbation cancellation) produced exactly **300 perturbed bytes** = 100 pixels × 3 RGB channels at seed-derived offsets. |
| Slice 2 step 5e (Module 4.2): xorshift32 perturbation positions | ✅ done 2026-05-19 | `applyFarble` swapped from fixed stride-400 + seed-derived start offset to xorshift32 chain seeded from the per-origin seed — 100 pseudo-random pixel positions per call. Same seed → same xorshift sequence → same positions → A/B determinism intact. **Anti-averaging hardening:** a fingerprinter doing N readbacks and taking the median can't recover truth because positions are unpredictable (every reading deterministic per origin → median = perturbed value, not original). Total perturbation count ~94–100 pixels with a small expected xorshift collision rate. Comment in M4.4 readPixels updated (the constraint moved from "stride assumes 4 bytes/px" to "pixel-count math assumes 4 bytes/px"; same skip-list applies). **Verified:** creepjs full-pass (every probe ✔); between-call diff=0 on 100×100 (xorshift determinism); 100×100 ground-truth diff=294 bytes / 98 pixels (predicted 280–300 / 93–100); M4.4 readPixels A/B diff=0; M4.5 createImageBitmap pipeline intact (test self-cancels via XOR but pipeline survives — direct byte-diff was rigor-verified in M4.5 row); 3-site spot smoke (browserleaks/canvas hits the documented sandbox-iframe ceiling cleanly, creepjs clean pass with `14 corrupted`, nytimes loads without extension errors). |
| Slice 2 step 6 (Module 5): audio farbling — AudioBuffer + AnalyserNode | ✅ done 2026-05-19 | `AudioBuffer.prototype.getChannelData`: Float32 additive ±0.0001 noise at 100 xorshift positions, **WeakMap<AudioBuffer, Set<channel>> dedup** so two reads of same (buffer, channel) return identical perturbed `Float32Array` reference — closes the additive-accumulation detection vector (see "Resolved during Slice 2 build" → WeakMap dedup pattern). `AnalyserNode.prototype.{getFloat,getByte}{Frequency,TimeDomain}Data`: perturb caller-owned buffer in-place after native fill, no dedup (each call independent). All wrappers brand-true receiver-guarded (`[object AudioBuffer]`, `[object AnalyserNode]` per the locked M4.1 pattern). Float ±0.0001 = inaudible (well below 16-bit PCM step ~3e-5 dither floor); Byte XOR 1 = 1/256 ≈ 0.39% shift, invisible in EQ visualizers. **Verified:** creepjs full-pass with audio probe ✔, `14 corrupted` (+5 vs pre-M5, matches the 5 new wrapped methods). `getChannelData` two-read same-buffer diff=0 confirming WeakMap dedup works. OfflineAudioContext oscillator→dynamicsCompressor signal, sum of `|d[i]|` across samples [4500–5000), OFF=`196.2394785889` ON=`196.2395786055`, Δ=+0.0001000166 ≈ 1 perturbation in the 500-sample window (predicted 100/44100 × 500 ≈ 1.13). |
| Slice 2 step 8 (Module 8): SW `onInstalled` farblerSecret bootstrap | ✅ done 2026-05-19 | `bootstrapFarblerSecret()` added to `background.js`. 64-byte random secret generated via `crypto.getRandomValues`, persisted to `chrome.storage.local` as 128-char hex. Idempotent — only writes when key is absent. Triggered on three signals: `chrome.runtime.onInstalled`, `chrome.runtime.onStartup`, and top-level SW execution (covers fresh install, browser startup, SW recycle). Content-script-side `getOrBootstrapSecret()` in `detect-watched.js` collapsed to `getSecret()` — single `chrome.storage.local.get` + HMAC, no inline bootstrap branch; if secret somehow missing the script logs `farblerSecret missing — SW bootstrap not yet landed, skipping farble this load` and writes `state=off`. **Verified:** wiped `farblerSecret` from SW console, reloaded extension, immediately re-read storage → `bytes: 128` confirming the SW regenerated it before any content script involvement. Closes the M2-finding first-install race that was previously leaking ~9 `state=off` canvas calls on the very first page load after install. |
| Real-world ceiling test — browserleaks/canvas hash unchanged | ⏳ known gap | POC's wrapper does not reach browserleaks's canvas test (1 iframe on the page, likely `about:blank`/`srcdoc` — sub-frame injection deferred to proper impl). Hash on browserleaks remains unchanged until sub-frame injection lands. |
| Slice 1: Tier A coverage + per-origin model | ⏳ partial (Tier A wrappers ✅; per-origin policy model pending) | Tier A property-getter lies shipped 2026-05-19 in inject.js right after the existing `hardwareConcurrency` / `languages` section: `navigator.languages` (was notify-only, now lies to `["en-US", "en"]`), `navigator.platform` → `"Win32"`, `navigator.deviceMemory` → `8`, `screen.{width,height}` snap-to-nearest of the 4 PRD-locked buckets ({1366×768, 1920×1080, 2560×1440, 3840×2160}) by Euclidean distance, `screen.{colorDepth,pixelDepth}` → `24`, `Performance.prototype.now()` floored to 100µs (0.1ms). All gated on `farbleState()`; snapped screen bucket cached at install time. No brand-check guards needed per the PRD's locked finding — Tier A wrappers are property descriptors, not prototype methods susceptible to wrong-receiver probes. **Per-origin policy model** (3-state engine with allowlist + scoperTrust integration) is the remaining Slice 1 work — deferred to Slice 3 alongside the visibility/UX layer. |
| Slice 3: Visibility layer + UX | ⏳ pending | After Slice 1 |
| Pre-merge cleanup: remove dual-injection in `detect-watched.js` | ✅ done 2026-05-19 | Was fixed during POC graduation — dynamic `<script>` injection removed from `detect-watched.js`; only manifest static injection remains. Comment at install site documents the bug class. |
| Real-site breakage smoke test (5 sites) | ✅ done 2026-05-19 | User-driven multi-site pass with `farbleDevMode=true` + DEBUG=true on Chrome/Linux/Mesa. Sites included BBC, NYT, Stripe (docs + checkout), Chrome developers (developer.chrome.com, developers.google.com), Greenhouse boards, WebAudio playground, plus the embedded ad/analytics/CDN frames each carried (chartbeat, doubleclick, doubleverify, googlesyndication, permutive, speedcurve, dotmetrics, ozone-project, etc. — ~20 unique origins all received their own per-frame per-tab seeds via `match_origin_as_fallback`). Metrics: 34 `state=per-tab` writes, 0 `state=off` fallbacks, 4 canvas farbles, 4 WebGL-constant lies, 4 size-gate skips, 0 `drawImage failed`, 0 `farblerSecret missing`. User report: nothing broke. The only console errors observed were (a) a clipboard-tool BOM paste artifact triggering `Uncaught SyntaxError` (user-side, not extension) and (b) one ANGLE `GL_INVALID_OPERATION` from a graphics-driver mipmap complaint (Chrome-side, not extension). |
| Slice 2 full-surface smoke test (8 sites, post-M5+M6) | ✅ done 2026-05-19 | Second pass with the full Tier B surface set (canvas + WebGL + audio + fonts) active. Sites: creepjs, browserleaks/fonts, browserleaks/canvas, browserleaks/webaudio, nytimes, bbc, youtube, amiunique. Metrics across all 8: **24** `state=per-tab` writes (across main + iframes), **0** `state=off` fallbacks, **0** `farblerSecret missing`, **0** `drawImage failed`, **0** TypeError from our code (one TypeError in log was `datadog-rum.js: Failed to fetch` — third-party telemetry blocked by user's network, unrelated). Surface-level firings: **14** canvas farbles (`flipped=100`), **15** WebGL UNMASKED_* lies, **2** readPixels fractional-dim skips (creepjs 17.07×42.67 — correct gate behavior), **19** measureText calls (creepjs's massive Win-font detection list classified into Arial bucket via `sans-serif` generic-family check — working as designed), **4** AudioBuffer.getChannelData, **3** AnalyserNode.getFloat*Data (2 freq + 1 time; no caller hit Byte variants this run), **128** 1×1 size-gate skips (font/emoji/rect probes correctly gated out). Sandbox-iframe ceiling re-confirmed on all 3 browserleaks pages: parent frame's seed sets cleanly but the `about:blank` test harnesses log `Blocked script execution... 'allow-scripts' permission is not set` — documented Phase 2 limit. NYT/BBC/YouTube/amiunique loaded with farbling active and no extension-side errors. User report: nothing broke. **Slice 2 done-gate satisfied — canvas + WebGL + audio + fonts all production-ready.** |
| Font cap list — Win32 single list | ✅ locked 2026-05-18 | 10 common fonts (Arial, Times, Courier, Verdana, Georgia, Tahoma, Trebuchet, Comic Sans, Impact, Lucida Console) |
| `screen.*` bucket set | ✅ locked 2026-05-18 | 1366×768, 1920×1080, 2560×1440, 3840×2160, snap-to-nearest |
| `hardwareConcurrency` value | ✅ locked 2026-05-18 | `4` (modal value, max blend) |

## References

- POC validation transcript: 2026-05-18 session, `data-wh-farble="on"` → `navigator.hardwareConcurrency === 4`
- JShelter wrappers list: vendored at `chrome-extension/fingerprint-surfaces.js` (149 surfaces, 12 categories)
- Cookie scoper PRD (sibling pattern): `docs/01-product/PRD.md` for Phase 0; wearecooked's `PRD.md` for the full scoper history
- AGENT_RULES.md (shared): `.claude/memory/AGENT_RULES.md`
