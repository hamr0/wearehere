# wearehere

<p align="center">
  <img src="https://img.shields.io/github/package-json/v/hamr0/wearehere?label=version&color=2a4f8c" alt="version">
  <img src="https://img.shields.io/badge/license-Apache--2.0-2a4f8c" alt="license: Apache-2.0">
</p>

> Privacy that acts back.

Every site you visit is watching. Some count your clicks. Some recognise your device. Some sell what they learn. Most do all three quietly, before you ever read a privacy policy.

**wearehere** shows you what's actually happening — and then does something about it.

## What it does for you

**Sees what's happening.** Open the popup on any page and you get a plain-English picture: who's watching this site, how they're doing it, and whether the fine print is fair or hostile.

**Cleans up after every site.** When you close a tab, wearehere quietly tightens the cookies that site left behind so trackers can't keep recognising you tomorrow. You don't have to think about it. Sites you actually trust can be kept — one click.

**Remembers who follows you.** Over time, wearehere builds a private picture of who's been watching you across the web — not just on one site, but everywhere. The same companies keep showing up. Now you can see them.

**Reads the terms so you don't have to.** Privacy policies and terms of service get scanned for the worst clauses — selling your data, no right to delete, forced arbitration. You get a fairness score, not a wall of legalese.

## What it doesn't do

- **No accounts.** Nothing to sign up for.
- **No cloud.** Nothing leaves your browser. Ever.
- **No AI.** No prompts sent anywhere.
- **No tracking us tracking them.** We don't even know you installed it.

Everything happens on your device. If you delete the extension, every trace goes with it.

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

> Firefox's "temporary add-on" resets when you close the browser — just re-load next session. We're working on a permanent listing.

## Two views

**The popup** — one click, the whole picture for the site you're on. Watchers, mechanisms, scoper status, fair-or-not on terms.

**The dashboard** — your privacy story over time. Who's been watching you this week, which sites are getting worse, how many cookies the scoper cleaned up. Open it from the popup.

## Who builds this

One developer. Open source, Apache-2.0 licensed. The detection logic builds on a handful of well-known privacy projects — full credit in [NOTICE](./NOTICE).

If you want to follow the build or report something weird, the issue tracker is open: [github.com/hamr0/wearehere/issues](https://github.com/hamr0/wearehere/issues).
