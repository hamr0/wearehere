# wearehere — User Guide

## What is wearehere?

wearehere shows you who is watching you on each site, and quietly makes that watching less useful.

- **It scans.** Every site you visit gets a score from 0 to 100 (lower is better) and a list of the companies watching.
- **It acts.** A built-in privacy guard shortens how long tracking cookies live and blurs the signals sites use to recognise your device.

No accounts. No cloud. Nothing leaves your browser.

---

## Installing

### Chrome

1. Download the wearehere ZIP file and extract it.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**.
5. Select the `chrome-extension` folder from the extracted files.

### Firefox

1. Download the wearehere ZIP file and extract it.
2. Open Firefox and go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on**.
4. Open the `firefox-extension` folder and select any file inside it.

The wearehere icon appears in your toolbar. If the popup says "site access needed", reload the tab once so it can scan from page load.

---

## What it does for you

### Cookie shortener

Cookies are how sites remember you, and how trackers follow you for weeks. The guard caps their life:

| Cookie | What happens |
|--------|--------------|
| Normal site cookies | Capped at **7 days** |
| Cookies on a site you trusted | Capped at **30 or 90 days** (your choice) |
| Tracker cookies (analytics, ads) | Turned into **session cookies**: gone when you close the tab |
| Partitioned and captcha/challenge cookies | **Left alone**: already limited to one site, and touching them breaks human-checks |

It runs in the background: when cookies are set, and in a regular sweep (hourly by default).

### Fingerprint blur

Sites can recognise your device without cookies, by reading small details like how your browser draws images, plays audio, or lists fonts. That is the **device-id** mechanism. The guard blurs those readings (canvas, audio, fonts, screen and navigator details, WebGL) so the same browser looks different to different sites.

Three modes:

- **rotation** (default): a different fingerprint per site, changing weekly.
- **stable**: one fixed fingerprint per site. Still blurred. Handy for sites you log into.
- **off**: no blur.

Blur applies on the next page load, not live.

---

## Using the Popup

Click the wearehere icon on any site.

- **Site and score**, for example `40 / MODERATE`, with a one-line verdict.
- **who's watching**: the top companies (a *watcher* is the company, who). `+N more` if there are more. If none: `no trackers detected ✓`.
- **Mechanism chips**: how they watch, with counts. Only the ones detected show up:
  - **cookies**: tracking cookies
  - **pixels**: hidden trackers, beacons, invisible frames
  - **device-id**: fingerprinting your device
  - **typing**: watching what you type in forms
  - **clicks**: tagged links and redirects
- **Footer chips** (always all shown):
  - `✓ not sold` / `[!] sold to N brokers`
  - `✓ fair terms` / `[!] strict terms` / `[!] toxic terms` (shown when the site's terms were found)
  - `✓ no pressure` / `[!] mild pressure` / `[!] aggressive pressure` (fake timers, "only 2 left", guilt buttons)
- **privacy guard** card, for this site:
  - A cookies line, for example `✓ Cookies expire in 7 days · 3 trimmed`.
  - A blur line, for example `✓ Tracking blurred · 4 surfaces`.
  - **[ trust cookies 30d ]**: keep this site's cookies up to 30 days. Becomes **[ untrust cookies ]**.
  - **[ trust ID ]**: turn blur completely off for this site. Becomes **[ untrust ID ]**. Reload the page to apply.
  - Running totals: cookies trimmed and surfaces blurred.
- **[ open full dashboard ]**

On browser pages (settings, new tab) the guard shows "not a regular site" and does nothing.

### Score

| Score | Label | Meaning |
|-------|-------|---------|
| 0 -- 15 | low | Fairly clean. Browse normally. |
| 16 -- 40 | moderate | Typical tracking. |
| 41 -- 70 | high | Significant risks. Avoid sharing personal info. |
| 71 -- 100 | critical | Very invasive. |

---

## The Dashboard

Three tabs. The theme button (top right) switches light and dark. On first open a short welcome appears; click `[ got it ]`.

### overview

Your lifetime and recent story.

- **Top numbers**: sites visited, average score, unique watchers, cookies trimmed, surfaces blurred.
- **Top 3 lists**: most-seen watchers, most-trimmed cookie domains, sites where blur worked most.
- **Window selector**: pick a time window for the rest of the tab.
- **Green line**: what the guard did in that window.
- **what changed**: new or gone watchers, score changes, and similar.
- **browsing exposure**: your sites sorted into clean, moderate and hostile.

### watchers

Who follows you across the web.

- **Top numbers**: sites visited, hidden contacts, unique watchers, cookies trimmed · surfaces blurred.
- **who follows you**: companies ranked by how many of your visits they appear in, and how (cookies, pixels, clicks, device-id), with Trimmed and Blurred counts.
- **recent visits**: per site score, watchers and terms. **[ clear history ]** erases this list.
- **dig deeper**: pick a site from the dropdown for its watcher detail and a breakdown of its terms of service (which clauses are concerning).

### privacy guard

- **Top numbers**: trimmed, blurred, sweeps run, last active.
- **cookies in your browser**: what is in your browser now, by lifetime and owner.
- **surfaces blurred**: which kinds of signals were blurred, how many sites run each mode, and the sites where blur fired most.
- **per-site rules**: your exceptions, one row per site. Type a site, choose cookies or blur, `[ add ]`. Then use the `[ → ]` buttons to cycle a cell:
  - cookies: 7d, 30d, 90d, back to 7d
  - blur: rotation, off, stable, back to rotation
  - `[ ✕ ]` removes the row.
- **settings**: how often the cookie sweep runs (15min, hourly, 4hr, 12hr), and the **default blur** mode (off, rotation, stable per origin).
- **recent activity**: a log of sweeps.

---

## Trust ID: the one escape hatch

Some sites break when anything touches their fingerprint readings. Banks, big retailers and anti-bot systems are the usual ones.

Click **[ trust ID ]** in the popup on that site. Blur is then **completely off** for it (main page, same-site frames and blank frames), and no blur code is loaded at all. Reload the page.

- Trust ID is about **blur only**. Cookie trust (30d / 90d) is a separate button with a separate effect.
- **stable** is not the same: it still blurs, just with a fixed fingerprint.
- To undo: click **[ untrust ID ]**.

---

## Logging in to a site that keeps failing

Some sites recognise your device when you sign in. A common case is a **magic link sent by email**: the site notes your device when you ask for the link, and checks it again when you click it. wearehere blurs your fingerprint, so the two moments can look like two different devices and the login is rejected.

Fix:

1. Open the popup on the site you are logging into.
2. Click **[ trust ID ]**.
3. Reload and try the login again.

Trust the site you log into. You do not need to trust the login provider behind it.

If it still fails and the site asks you to log in repeatedly, also try **[ trust cookies 30d ]** on that site.

---

## What wearehere does NOT do

- **It does not block anything.** Trackers still load. wearehere shortens their cookies and blurs your device signals. For blocking, pair it with a blocker like uBlock Origin.
- **It targets everyday fingerprinting scripts**, the kind used by commodity libraries. It is not built to beat the sophisticated detectors used by banks or anti-bot systems such as Akamai. Those can notice the blur: use Trust ID on such a site.
- **Third-party frames inside a trusted site stay blurred.** Trust ID covers the site itself, not embedded frames from other companies. We tried covering them and it broke logins, so it was dropped.
- **Sandboxed frames that run no scripts cannot be blurred** by any extension.
- **Private windows work only if you allow the extension there** in your browser's extension settings.

---

## Privacy

Everything stays on your device. No accounts, no servers, no analytics, no telemetry, no AI or cloud services. The code is open source.

The history you see in the dashboard is stored locally in your browser. **[ clear history ]** in the watchers tab erases the visit list.

---

## Tips and FAQ

**A page looks broken or stuck.** Open the popup, click `[ trust ID ]`, reload.

**I got logged out of a site a lot.** Click `[ trust cookies 30d ]` there. Use the dashboard to go to 90d.

**Does the cookie shortener log me out after 7 days?** Sites that keep you logged in with a normal cookie may need you to log in again after 7 days unless you trust cookies there.

**The numbers say 0 trimmed or 0 blurred.** Browse a few sites. They fill in as the guard works.

**Blur changed but nothing looks different.** That is the point. Pages look the same to you. Only the readings sites take change.

**Very quick visits are missing from the dashboard.** Scanning waits for the page to settle, so visits under about 2 seconds may not be counted.

**Check unfamiliar sites before entering personal information.** Open the popup first. Sites above 40 deserve extra caution.

**Read the terms chip before agreeing to anything.** `[!] toxic terms` means the site's terms have concerning clauses. Details are in the watchers tab.
