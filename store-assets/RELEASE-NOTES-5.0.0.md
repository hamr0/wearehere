# Release notes — 5.0.0 (Firefox AMO)

Covers everything since the last public Firefox release (4.1.1). Paste the user-facing block below into the AMO "Release Notes" field.

---

**wearehere 5.0.0 — Fingerprint blurring**

🛡️ **New: device-fingerprint blurring.** Trackers can recognise your browser from tiny technical details even after cookies are cleared. wearehere now feeds them slightly-wrong, per-site answers — so the same browser looks like a different device on every site it can't link together. It's **on by default** and your per-site disguise **rotates weekly**, so you can't be profiled over time either. Covers canvas, audio, fonts, WebGL and screen/device details.

- **A few sites don't like it.** If a site misbehaves under blurring (usually ones with aggressive bot-detection), wearehere notices you reloading and offers a one-click **relax & reload** that turns blurring off just for that site.
- **Sites you log into stay stable.** Trust a site (or its cookies) and it gets one consistent disguise, so you don't get logged out or hit "new device" checks.

🔎 **Privacy guard.** The popup and dashboard now show blurring right next to cookie trimming — surfaces blurred, cookies trimmed, all in one place. The Watchers list shows how much was shielded against each company that follows you.

⚡ **Better cookie cleanup (since 4.1.1).** Cookies are now re-trimmed in real time — the moment a site re-issues a long-lived tracker cookie, wearehere shortens it again, instead of waiting for the next scheduled sweep.

🦊 **Firefox fixes (since 4.1.1).**
- After an update, the popup now shows a clear **reload tab / open settings** prompt when a site needs permission re-confirmed, instead of an empty panel.
- Content scripts exit cleanly when the extension reloads — no more console error flood on busy pages.
- The popup no longer goes blank when you return to a long-idle tab.
- Terms-and-conditions reads no longer flip-flop between "found" and "couldn't find a terms page."

**An honest note:** blurring raises the cost of tracking — it doesn't make you invisible. It won't beat privacy-focused browsers like Tor, or bank-grade anti-fraud systems. And wearehere doesn't block ads or requests — pair it with uBlock Origin for that.
