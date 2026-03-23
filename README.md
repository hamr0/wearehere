# wearehere

> Full privacy scan for every site you visit — one popup, complete picture.

Every website you visit drops cookies, hides tracking pixels, fingerprints your device, buries toxic clauses in its terms, and tags your clicks. Each of these is a separate problem. wearehere scans for all of them at once and gives you a single risk score — so you know what you're walking into before you hand over anything.

No AI, no cloud, no accounts — everything runs locally in your browser.

## What it scans

| What you see | What it means |
|---|---|
| **Cookies** | How many cookies this site set, which ones are from outside companies, how long the longest one lasts |
| **Network** | Real-time request monitoring — which domains your browser talks to, tracker domains, third-party traffic |
| **Trackers** | Hidden tracking pixels, invisible iframes, silent pings (beacons), and third-party scripts — resolved to company names |
| **Pressure** | Dark patterns: fake countdown timers, "Only 2 left!", guilt-trip decline buttons, pre-checked newsletter boxes |
| **Selling data** | Data broker connections detected in network traffic |
| **Profiling** | When sites read your device specs (GPU, CPU cores, screen depth, audio hardware) to build a unique ID — no cookies needed |
| **Stored data** | Tracking IDs and analytics tokens saved in your browser's local storage, categorized by type |
| **Watching** | Which form fields are on the page and whether trackers are active while you type |
| **Clicks** | UTM parameters and redirect wrappers attached to links so they know what you click next |
| **Terms** | Toxic clauses in their privacy policy and terms of service — data selling, surveillance, binding arbitration, no right to delete |

## How scoring works

Each category contributes to a combined risk score (0–100). Weights: Trackers 20, Profiling 20, Cookies 15, Pressure 15, Terms 15, Network 10, Selling data 10, Watching 10, Stored data 5, Clicks 5.

| Score | Badge | Meaning |
|---|---|---|
| 0–15 | Green | Fairly clean. Browse normally. |
| 16–40 | Orange | Typical tracking. Private browsing helps. |
| 41–70 | Red | Significant risks. Avoid sharing personal info. |
| 71–100 | Red | Very invasive. Use tracker blocking or avoid. |

## Module sources

wearehere reuses detection logic from the weare____ suite — same code, not rewritten:

| Detection | Source extension | Version |
|-----------|-----------------|---------|
| ToS scanning | wearetosed `scanner.js` | v0.1.0 |
| Fingerprint wrappers | wearewatched `inject.js` | v0.1.0 |
| Tracker company map (258 entries) | wearecooked `content.js` | v4.0.0 |
| Dark pattern heuristics | weareplayed `content.js` | v0.1.0 |
| Categorized storage patterns | weareleaking `content.js` | v0.2.0 |
| Tracking params | wearelinked `content.js` | v0.3.0 |
| Network domains (454 trackers, 82 brokers) | wearebaked `background.js` | v0.5.1 |
| Form field scanning (Method B) | wearesilent `content.js` | v0.1.0 |

## Dashboard

Click **Full Report** in the popup to open the unified dashboard with 6 tabs:

- **Overview** — score, at-a-glance cards (10 categories with colored borders), concerns, stacked weight bar, score breakdown with +pts/max
- **Cookies** — searchable/sortable cookie table, cookie cleaner (Clean Third-Party / Clean All)
- **Network** — request categories, domain table, data broker detection, redirect chains
- **Terms** — toxicity score and flagged clauses for privacy policy and terms of service
- **Tracking** — 7 sections in 2-column masonry layout: Trackers, Selling data, Pressure, Profiling, Stored data, Watching, Clicks
- **Network Map** — interactive force-directed graph showing all third-party connections from a single page visit. Nodes represent domains (sized by impact, colored by category), edges show the connection from your visit to each tracker. Features: cluster by parent company, essentials mode (green/red split of essential vs non-essential), category filtering, side-by-side comparison of two sites, click-to-trace with full connection details, data flow particles, and cookie count badges

## npm package

wearehere publishes an npm package so you can run privacy audits programmatically — same detection logic, headless browser via [barebrowse](https://github.com/hamr0/barebrowse).

```bash
npm install wearehere
```

```js
import { assess } from 'wearehere';

const page = await connect({ mode: 'headless' }); // from barebrowse
const result = await assess(page, 'https://example.com');
console.log(result.score, result.risk);
await page.close();
```

The output is a compact assessment: score (0--100), risk level, per-category breakdown (10 categories with score/max/summary), concerns list, and recommendation.

For AI agents, barebrowse exposes wearehere as its `assess` tool — no separate setup needed. Install barebrowse with wearehere and the tool appears automatically.

## Try It Now

### Chrome
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `chrome://extensions` and turn on **Developer mode** (top right)
3. Click **Load unpacked** → select the `chrome-extension` folder
4. That's it — browse any site and click the extension icon

### Firefox
1. Download this repo (Code → Download ZIP) and unzip
2. Go to `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on** → pick any file in the `firefox-extension` folder
4. That's it — browse any site and click the extension icon

> Firefox temporary add-ons reset when you close the browser — just re-load next session.

---

## The weare____ Suite

Privacy tools that show what's happening — no cloud, no accounts, nothing leaves your browser.

| Extension | What it exposes |
|-----------|----------------|
| [wearecooked](https://github.com/hamr0/wearecooked) | Cookies, tracking pixels, and beacons |
| [wearebaked](https://github.com/hamr0/wearebaked) | Network requests, third-party scripts, and data brokers |
| [weareleaking](https://github.com/hamr0/weareleaking) | localStorage and sessionStorage tracking data |
| [wearelinked](https://github.com/hamr0/wearelinked) | Redirect chains and tracking parameters in links |
| [wearewatched](https://github.com/hamr0/wearewatched) | Browser fingerprinting and silent permission access |
| [weareplayed](https://github.com/hamr0/weareplayed) | Dark patterns: fake urgency, confirm-shaming, pre-checked boxes |
| [wearetosed](https://github.com/hamr0/wearetosed) | Toxic clauses in privacy policies and terms of service |
| [wearesilent](https://github.com/hamr0/wearesilent) | Form input exfiltration before you click submit |
| **wearehere** | All of the above in one scan |

All extensions run entirely on your device and work on Chrome and Firefox.
