# Manual smoke test — run before any release

Per `PLAN.md` test plan section. The unit suite (`npm test`) covers the data-pipeline contracts (visits → snapshots, SSRF guard, ring buffer, window math). The 8-step path below is the integration check that exercises the **UI surfaces** — popup, dashboard, scoper sweep behavior — which can't be exercised from Node.

## Setup

1. Fresh Chrome profile (no other extensions installed).
2. `chrome://extensions` → **Developer mode** ON → **Load unpacked** → pick `chrome-extension/`.
3. Open DevTools on the service worker (`chrome://extensions` → wearehere card → **Service worker** link) — keep it open to watch the `[visits]` / `[scoper]` / `[snapshots]` lifecycle logs.

## The 8 steps

1. **Browse 10 mixed sites** across 3 sessions (close + reopen the browser between sessions). Suggested mix: 4 news (CNN, NYT, BBC, Guardian) + 3 shopping (Amazon, eBay, Etsy) + 1 social (Twitter/Reddit/Mastodon) + 2 dev (GitHub, Stack Overflow).

2. **Per-tab check**: open the popup on each site.
   - Score number appears with verdict ("MODERATE" / etc.) and one-line copy.
   - "Who's watching" lists 0–3 companies + `+N more` if applicable.
   - Mechanism chip line shows the right subset (`cookies · pixels · device-id · typing · clicks`).
   - Footer chips render (sold / terms / pressure).
   - Cookie scoper card shows site name, cap status, and `[ Sweep now ]` / `[ Trust 30d ]` button.
   - Click `[ Trust 30d ]` on one site → button text changes to `[ Remove trust ]`, cap line updates.

3. **Open the dashboard** from the popup.
   - **Overview tab**: hero shows 4 stats (sites / avg score / unique watchers / most exposed). Window selector defaults to `week`. Switching to `today` / `month` / `all` re-filters everything.
   - "What changed" event log lists at least a few `new site` events from the fresh browsing.
   - Score trend SVG renders with tier bands + per-visit dots.
   - **Watchers tab**: hero shows `sites visited / hidden contacts / unique watchers / amplification`. "Who follows you" shows companies ranked by reach %.
   - Recent visits table lists each browsed site with tag-along count, top watchers, and terms score.
   - Per-tab `watchers` / `terms` site selectors populate with open tabs.
   - **Cookie scoper tab**: lifetime hero updates. Cookies-in-your-browser block shows coverage + by-expiry + top owners. Trusted sites table lists the one site you trusted in step 2.

4. **Trigger a manual sweep** from the popup (`[ Sweep now ]`).
   - Service worker log: `[scoper] sweep (manual): scanned N, rewrote M, demoted K`.
   - Scoper tab "Recent activity" log gains a new row with `trigger=manual`.

5. **Remove trust** from the site you trusted in step 2.
   - Popup button reverts to `[ Trust 30d ]`.
   - Wait for the next alarm tick (or trigger another manual sweep) — verify cookies on that site get re-capped (1yr+ expirations should drop to 7d).

6. **Force-quit the browser** (Cmd-Q on macOS, kill the process on Linux). Reopen.
   - All visit history survives (`Watchers → Recent visits` still populated).
   - Trust list survives.
   - Scoper counters survive.

7. **DevTools device emulation** at 360×640 and 768×1024 (or use real mobile).
   - Popup still readable, no horizontal scroll.
   - Dashboard tabs stack naturally, no broken layouts.

8. **Edge cases**:
   - `chrome://extensions` (extension's own surfaces) → popup should gracefully say `not a regular site — scoper inactive here`.
   - PDF or non-HTML resource open → popup shouldn't crash.
   - Site with zero trackers → popup shows `No trackers detected ✓`, no chip line.

## Acceptance bar

Every step above passes without console errors in the service worker or any open page. The unit suite (`npm test`) reports 18/18 pass.

## Known caveats — not failures

- Dashboard Overview aggregates can lag up to ~5 min behind a fresh visit while you're actively browsing (window-snapshot staleness window). Refreshing the dashboard or switching the window selector forces a re-read but not a recompute.
- 16px toolbar icon has faint bracket hints, not pixel-sharp brackets — that's intrinsic to the pixel budget.
- `[ Show all (N) ]` expander on "What changed" + several other v4.x polish items are punted to PRD `Deferred`; they don't gate this smoke pass.

## Firefox smoke

`firefox-extension/` is still on the v3.x feature set despite the v4.0.0 manifest version label. Phase 7 mirror is the actual port; this smoke test does not apply to Firefox yet.
