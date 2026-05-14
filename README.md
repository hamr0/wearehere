# wearehere

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/hamr0/wearehere?label=version&color=2a4f8c" alt="version">
  <img src="https://img.shields.io/badge/license-Apache--2.0-2a4f8c" alt="license: Apache-2.0">
</p>

> Privacy that acts back.

wearehere is a browser extension that shows you who's watching you on every site you visit — and quietly cleans up after them. It lives in your toolbar. One click opens the popup for the page you're on. From there you can open the full dashboard.

Nothing leaves your browser. No accounts, no cloud, no AI calls.

## The popup — one site, right now

Click the wearehere icon on any page. You get:

- **A score, 0–100.** Lower is better. It summarises how much tracking pressure this page is putting on you.
- **A verdict in plain English.** What this site is doing and whether the terms are fair or hostile.
- **Who's watching.** The companies seeing you on this page, and how they're doing it — cookies, pixels, clicks, device-id, form fields.
- **Cookie scoper card.** What the scoper is doing for this site, with two buttons: **sweep now** (clean its cookies right away) and **trust 30d** (keep this site's cookies if it's one you actually use).
- **Open full dashboard.** Sends you to the longer view.

## The dashboard — three tabs

Open it from the popup. Three tabs along the top.

### overview

Your browsing at a glance, for a window you pick (day, week, month, all time).

- **sites visited · avg score · unique watchers · most exposed** — the four numbers up top.
- **What changed.** Sites getting worse or better since the previous window.
- **Score trend.** A line showing how your average tracking pressure moved over time.
- **An impact line.** "This week, wearehere shortened 1,240 cookies and demoted 38 trackers to session-only so they can't recognise you tomorrow."

### watchers

Who keeps showing up across your visits — not just on one site, everywhere.

- **sites visited · hidden contacts · unique watchers · avg per visit** — the four numbers up top.
- **Who follows you.** A ranked list of companies, with how often they appear and the mechanisms they use (cookies, pixels, clicks, device-id).
- **Recent visits.** A scrollable log of the sites you've been on and what each one tried. Clearable with one button.
- **Dig deeper · per site.** Pick any open tab from a dropdown to see its watchers in detail, and a fairness read of its terms and privacy policy.

### cookie scoper

The background cleaner. It tightens the cookies sites leave behind so trackers can't keep recognising you tomorrow.

- **tightened · trackers killed · sweeps run · last sweep** — lifetime counters.
- **Cookies in your browser.** How many cookies are sitting in your browser right now, broken down by what the scoper will do with them (capped, trusted, demoted to session) and by how long they'd otherwise live (session, < 7 days, < 30 days, < 90 days, 90 days +). Top owners listed.
- **Trusted sites.** Sites you've told wearehere to leave alone. Add a domain, extend it to 90 days, or remove it.
- **Sweep period.** How often the scoper runs in the background. Pick the interval.
- **Recent activity.** A log of recent sweeps and what they touched.

## What it doesn't do

- **No accounts.** Nothing to sign up for.
- **No cloud.** Nothing leaves your browser. Ever.
- **No AI.** No prompts sent anywhere.
- **No tracking us tracking them.** We don't even know you installed it.

Delete the extension and every trace goes with it.

## Install

### Chrome
1. Download this repo (Code → Download ZIP) and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `chrome-extension` folder.
4. Click the wearehere icon in your toolbar. That's it.

### Firefox
1. Download and unzip the repo.
2. Open `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on** and pick any file in the `firefox-extension` folder.
4. Click the wearehere icon. That's it.

## License

Open source, Apache-2.0. Detection logic builds on a handful of well-known privacy projects — full credit in [NOTICE](./NOTICE).

Issues and feedback: [github.com/hamr0/wearehere/issues](https://github.com/hamr0/wearehere/issues).
