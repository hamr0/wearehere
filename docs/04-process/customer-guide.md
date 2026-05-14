# wearehere — User Guide

## What is wearehere?

wearehere is a privacy scanner for your browser. It checks every website you visit and shows you what is happening behind the scenes — cookies, trackers, fingerprinting, dark patterns, and more.

There are no accounts to create, no cloud services involved, and nothing leaves your browser. The extension runs entirely on your device and gives each site a risk score from 0 to 100 so you can make informed decisions about where you share your information.

---

## Installing

### Chrome

1. Download the wearehere ZIP file and extract it.
2. Open Chrome and go to `chrome://extensions` in the address bar.
3. Turn on **Developer mode** using the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Select the `chrome-extension` folder from the extracted files.

The wearehere icon will appear in your browser toolbar.

### Firefox

1. Download the wearehere ZIP file and extract it.
2. Open Firefox and go to `about:debugging#/runtime/this-firefox` in the address bar.
3. Click **Load Temporary Add-on**.
4. Navigate into the `firefox-extension` folder and select any file inside it.

The wearehere icon will appear in your browser toolbar.

**Note:** Firefox treats this as a temporary add-on. It will be removed when you close the browser, and you will need to load it again next time.

---

## Using the Popup

Click the wearehere icon in your toolbar while visiting any website. A popup will appear showing:

- **The site name** you are currently visiting.
- **A risk score** from 0 to 100.
- **A color-coded badge** — green means safe, orange means moderate risk, and red means risky.

Below the score, you will see 10 sections covering different privacy categories:

1. **Cookies** — How many cookies the site sets, which ones come from third parties, and how long they last.
2. **Network** — Which domains your browser communicates with in the background, and how many of them are known trackers.
3. **Trackers** — Hidden tracking pixels, invisible iframes, and beacons that silently report your activity back to other companies.
4. **Pressure** — Manipulative design tricks such as fake countdown timers, "only 2 left" warnings, guilt-trip buttons, and pre-checked consent boxes.
5. **Selling data** — Whether the site connects to known data brokers.
6. **Profiling** — When a site reads details about your device hardware (screen size, graphics card, fonts) to build a unique fingerprint that identifies you.
7. **Stored data** — Tracking IDs saved in your browser's local storage, which can persist even after you clear cookies.
8. **Watching** — Whether trackers are actively monitoring while you fill out forms, capturing keystrokes or field changes before you even submit.
9. **Clicks** — Tracking parameters and redirect wrappers attached to links on the page.
10. **Terms** — Toxic or concerning clauses found in the site's privacy policy and terms of service.

---

## Understanding Your Score

The risk score ranges from 0 to 100. Here is what the ranges mean:

| Score | Color | What it means |
|-------|-------|---------------|
| 0 -- 15 | Green | Fairly clean. You can browse normally. |
| 16 -- 40 | Orange | Typical tracking activity. Using private browsing or clearing cookies after your visit helps. |
| 41 -- 70 | Red | Significant privacy risks. Avoid sharing personal information on this site. |
| 71 -- 100 | Red | Very invasive. Consider using a tracker blocker or avoiding this site entirely. |

### How the score is calculated

Each of the 10 categories contributes to the overall score, but some categories carry more weight than others:

| Category | Weight |
|----------|--------|
| Trackers | 20 |
| Profiling | 20 |
| Cookies | 15 |
| Pressure | 15 |
| Terms | 15 |
| Network | 10 |
| Selling data | 10 |
| Watching | 10 |
| Stored data | 5 |
| Clicks | 5 |

A site that fingerprints your device (Profiling) will raise the score more than a site that only adds tracking parameters to links (Clicks), because fingerprinting is harder to defend against and more invasive.

---

## The Full Report

Click the **Full Report** button in the popup to open a detailed dashboard. The report is organized into five tabs:

- **Overview** — Your score visualized as a chart, all categories shown at a glance, and the top concerns highlighted.
- **Cookies** — A full table of every cookie on the site. You can search, sort, and see exactly what each cookie does.
- **Network** — Every domain your browser contacted while loading the page, organized by category, with alerts for known data brokers.
- **Terms** — What the site's privacy policy and terms of service actually say, with concerning clauses scored by how toxic they are.
- **Tracking** — A deep dive into fingerprinting techniques, form surveillance, storage-based tracking, and link tracking.

---

## Cleaning Cookies

In the Full Report, go to the **Cookies** tab. You will find two buttons:

- **Clean Tracking Cookies** — Deletes only the cookies classified as analytics or advertising. Your login and preferences are left alone.
- **Clean All Cookies** — Deletes every cookie for the current site. You may be logged out afterward.

---

## What wearehere Does NOT Do

- **It does not block anything.** wearehere is a scanner, not a blocker. It shows you what is happening but does not intervene.
- **It does not send any data anywhere.** Everything stays in your browser. There are no servers, no analytics, no telemetry.
- **It does not require an account or signup.** Install it and it works immediately.
- **It does not use AI or cloud services.** All analysis runs locally on your device.
- **It does not modify web pages.** The sites you visit look and behave exactly the same.

---

## Tips

- **Check unfamiliar sites before entering personal information.** Open the popup before typing anything into a form.
- **Sites scoring above 40 deserve extra caution.** Think twice before sharing sensitive details.
- **Use the Terms tab before agreeing to anything.** It highlights the clauses that matter most.
- **The Network tab shows who your browser talks to in real time.** This is useful for spotting unexpected connections to advertising networks or data brokers.
- **Pair wearehere with a tracker blocker** like uBlock Origin for the best results. wearehere shows you the problem; a blocker fixes it.

---

## Privacy

wearehere itself is private. There is zero data collection, zero network calls, and zero accounts. The extension's code is open source and runs entirely on your device. It practices what it preaches.
