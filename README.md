# wearehere

> Full privacy scan for every site you visit — one popup, complete picture.

Every website you visit drops cookies, hides tracking pixels, fingerprints your device, buries toxic clauses in its terms, and tags your clicks. Each of these is a separate problem. wearehere scans for all of them at once and gives you a single risk score — so you know what you're walking into before you hand over anything.

No AI, no cloud, no accounts — everything runs locally in your browser.

## What it scans

| What you see | What it means |
|---|---|
| **Cookies** | How many cookies this site set, which ones are from outside companies, how long the longest one lasts |
| **Trackers** | Hidden tracking pixels, invisible iframes, silent pings (beacons), and third-party scripts loaded without your knowledge |
| **Fingerprinting** | When sites read your device specs (GPU, CPU cores, screen depth, audio hardware) to build a unique ID — no cookies needed |
| **Pressure** | Dark patterns: fake countdown timers, "Only 2 left!", guilt-trip decline buttons, pre-checked newsletter boxes |
| **Terms** | Toxic clauses in their privacy policy and terms of service — data selling, surveillance, binding arbitration, no right to delete |
| **Stored on you** | Tracking IDs and analytics tokens saved in your browser's local storage |
| **Link tracking** | UTM parameters and redirect wrappers attached to links so they know what you click next |

## How scoring works

Each category contributes to a combined risk score (0–100).

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
| Tracker domains | wearecooked `content.js` | v4.0.0 |
| Dark pattern heuristics | weareplayed `content.js` | v0.1.0 |
| Storage patterns | weareleaking `content.js` | v0.2.0 |
| Tracking params | wearelinked `content.js` | v0.3.0 |

## Dashboard links

The popup footer links to two companion dashboards (install separately):

- **Cookie Dashboard** → [wearecooked](https://github.com/hamr0/wearecooked) — full cookie analysis, worst offenders, cookie cleaner
- **Network Dashboard** → [wearebaked](https://github.com/hamr0/wearebaked) — real-time network traffic, data broker detection, redirect chains

## MCP server

wearehere also ships an MCP server for AI agents. Give it a URL, get back a full privacy audit as structured JSON — same detection logic, headless browser via [barebrowse](https://github.com/hamr0/barebrowse).

```json
{
  "mcpServers": {
    "wearehere": {
      "command": "node",
      "args": ["/path/to/wearehere/mcp-server.js"]
    }
  }
}
```

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
