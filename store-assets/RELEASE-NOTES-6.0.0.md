# Release notes — 6.0.0 (Chrome Web Store + Firefox AMO)

Covers everything since 5.0.0. Two blocks below: the Chrome Web Store justification for the new `scripting` permission, and the user-facing text for the Firefox AMO "Release Notes" field.

---

## Chrome Web Store — `scripting` permission justification

`scripting` is the only permission new in 6.0.0 (`cookies`, `webRequest`, `alarms`, `storage` and `<all_urls>` were already in 5.0.0).

> wearehere uses the scripting permission for one purpose: to register its own fingerprint-protection script (inject.js, bundled with the extension) with chrome.scripting.registerContentScripts, so it can keep the user's "Trust ID" sites off that registration with excludeMatches.
>
> Trust ID is the user's per-site whitelist. When a user trusts a site, typically one they log into, wearehere must leave that site completely untouched, so that login and bot checks see the browser exactly as it is. A static manifest content script can't skip sites the user chooses at runtime. Registering the script dynamically lets us exclude exactly the trusted sites and update that list when the user changes it.
>
> We never inject code fetched from the network, never run code supplied by a website, and never use executeScript to read or change page content. The only script registered is our own packaged inject.js. No data is collected or sent anywhere.

---

## Firefox AMO — release notes

**wearehere 6.0.0: see who follows you, by company**

👁️ **Watchers grouped by company.** Google Ads, Google Analytics and YouTube now count as **Google**; Facebook counts as **Meta**, LinkedIn as **Microsoft**, and so on. Each company counts once per visit. Companies wearehere saw but didn't need to act on are listed on one line, and an **everything else** row makes the totals add up.

📊 **See what wearehere did on each visit.** Recent visits now show **trim · blur**: how many cookies were shortened and how many fingerprint details were blurred on that page. The Watchers tab shows trimmed · blurred for the period you pick, and big numbers read as 1.2k or 250k (hover for the exact count).

🔒 **Trust ID now leaves trusted sites fully alone.** Sites you trust get no blurring at all, so logins and "verify you're human" checks behave exactly as without wearehere. CAPTCHA and challenge frames (Cloudflare, hCaptcha, reCAPTCHA and others) are never touched either. The "relax & reload" banner from 5.0.0 is gone: Trust ID is now the one switch for a site that misbehaves.

🦊 **Blurring now works in Firefox.** In 5.0.0, blurring silently never ran in Firefox. It now runs in every frame of a page, including embedded and blank frames.

⚡ **Faster pages.** Tracker counting now waits until the page has settled, in small idle slices, so it no longer slows pages down while they load. Infinite-scroll pages like Vinted and busy news sites are noticeably lighter.

📜 **Smarter terms check.** wearehere now catches more unfair clauses, including forced arbitration, class-action waivers, termination at will and broad content licences. It only scores text that actually reads like a legal policy, so short stub pages no longer earn a false "fair terms" badge.

🛠️ **Fixes**
- Logging in to some Cloudflare-protected sites failed even with Trust ID on. Fixed.
- Google's own long-lived cookies are trimmed again. Only reCAPTCHA's cookie is left alone.
- Visits were sometimes lost or merged when you moved between sites in the same tab, or clicked a download link. Each visit is now recorded once, correctly.
- Sites opened by IP address (like 127.0.0.1) are handled properly, and Trust ID works on them.
- The popup no longer lists the same company more than once.
- The dashboard no longer scrolls sideways in narrow windows.

**An honest note:** blurring raises the cost of tracking; it doesn't make you invisible. It won't beat Tor-style browsers or bank-grade anti-fraud systems, and wearehere doesn't block ads or requests. Pair it with uBlock Origin for that.
