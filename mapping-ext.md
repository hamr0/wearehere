# wearehere v3 — Extension Mapping

## Final Tab/Section Names

| # | Dashboard Tab | Popup Section | Module ID | Original Extension | Approach |
|---|---------------|---------------|-----------|-------------------|----------|
| 1 | Overview | *(none)* | all | — | custom |
| 2 | Cookies | Cookies | `cooked` | wearecooked | **exact port** of `wearecooked/report.js` |
| 3 | Network | *(none)* | `baked` | wearebaked | **exact port** of `wearebaked/dashboard.js` |
| 4 | Fingerprinting | Fingerprinting | `watched` | wearewatched | rebuild |
| 5 | Dark Patterns | Dark Patterns | `played` | weareplayed | rebuild |
| 6 | Terms | Terms | `tosed` | wearetosed | rebuild |
| 7 | Storage | Storage | `leaked` | weareleaking | rebuild |
| 8 | Links | Links | `linked` | wearelinked | rebuild |
| 9 | Forms | Forms | `silent` | wearesilent | rebuild |

---

## Original vs wearehere — What Each Shows

### 1. Cookies — exact port of wearecooked report.js

**Approach:** Take the entire wearecooked dashboard (`report.js`) and port it as the Cookies tab. No merging, no redesign.

**What the original wearecooked dashboard shows:**
- Summary cards: Total cookies, Unique Domains, Tracking/Ads %, Secure, Session/Persistent
- 1P vs 3P visual stacked bar + legend
- Privacy insights: Expired cookies, Long-lived cookies (1yr+), Cross-site (SameSite=None)
- Worst offenders: Top 8 domains ranked by concern score with reasons
- Category bar chart: Analytics, Advertising, Session/Auth, Preference, CDN, Captcha, Social, E-commerce, 3P uncategorized, Functional
- Full cookie table: Domain, Name, Value, Path, Expires, Flags, Category (searchable, filterable, sortable)
- Clean Cookies CTA

**Source files:** `/home/hamr/PycharmProjects/wearecooked/chrome-extension/report.js` + `report.html` + `report.css`

---

### 2. Network — exact port of wearebaked dashboard.js

**Approach:** Take the entire wearebaked dashboard (`dashboard.js`) and port it as the Network tab. No merging, no redesign.

**What the original wearebaked dashboard shows:**
- Summary cards: Total Requests, Unique Domains, Third-Party %, Trackers/Ads, 3P Domains, 3P Scripts, WebSockets
- Privacy summary: narrative sentence + risky/unknown/benign stacked bar
- Domain list: Top 20 concerning domains by concern score, with category tags + broker pills
- Category bar chart with colors
- Data brokers: Grouped by type (Consumer, Marketplace, Identity, Audience) with domain + desc + count
- Beacons: Regular-interval requests with confidence %
- New domains: Suspicious new domains this session
- Redirect chains: Hop visualization
- Data flow: Upload/download per domain, upload-heavy flagging
- WebSockets: Active connections with message count
- Live feed: Real-time request table with search/filter/category/3P toggle
- Auto-refresh: 3s toggle
- Per-tab breakdown: Request count + 3P domain count per tab

**Source files:** `/home/hamr/PycharmProjects/wearebaked/chrome-extension/dashboard.js` + `dashboard.html` + `dashboard.css`

---

### 3. Fingerprinting (wearewatched)

| | Original wearewatched popup | wearehere popup | wearehere dashboard |
|---|---|---|---|
| **Verdict** | Domain + count + level (clean/warn/bad) | "Active"/"None" | Status banner |
| **Breakdown** | Two sections: "Identifying your device" + "Accessing your data" | Technique names as comma list | Technique cards |
| **API details** | Friendly names per API ("Drew a hidden image to ID your device") + call count | *(missing from popup)* | API names as code tags + explanations |

**Missing from wearehere popup:** Friendly API descriptions, call counts, category grouping (fingerprint vs permission)

---

### 4. Dark Patterns (weareplayed)

| | Original weareplayed popup | wearehere popup | wearehere dashboard |
|---|---|---|---|
| **Verdict** | Domain + score/100 + message ("No tricks" / "Mild pressure" / "Nudging you" / "Playing you") | Score/100 or "None" | *(Overview score breakdown only)* |
| **Breakdown** | Two sections: "Pressure tactics" (countdown, discount, scarcity) + "Deceptive design" (prechecked, shaming, hidden-unsub) with counts | Flat tactic descriptions | **NO TAB — needs Dark Patterns tab** |

**Missing from wearehere:** Dedicated dashboard tab, two-section grouping (pressure vs deceptive), per-pattern counts

---

### 5. Terms (wearetosed)

| | Original wearetosed popup | wearehere popup | wearehere dashboard |
|---|---|---|---|
| **Verdict** | Domain + score/100 + "toxicity score" label + message | Score/100 or "..."/"???" | Score display |
| **Privacy Policy** | Separate section with own score/100 + flagged patterns | *(combined into single score)* | *(combined)* |
| **Terms of Service** | Separate section with own score/100 + flagged patterns | *(combined)* | *(combined)* |
| **Breakdown** | Two groups: "Data practices" (sharing, surveillance, retention) + "Your rights" (law enforcement, rights, unilateral) with counts | Flat list of flagged labels | Flagged clauses with match counts |

**Missing from wearehere:** Separate Privacy Policy vs Terms sections with individual scores, two-group breakdown

---

### 6. Storage (weareleaking)

| | Original weareleaking popup | wearehere popup | wearehere dashboard |
|---|---|---|---|
| **Verdict** | Domain + flagged/total count + level | Suspicious count or total or "None" | *(in Overview)* |
| **Flagged** | Categories sorted by severity (Cross-site tracking, Advertising, Fingerprinting, PII, Tracking) with counts | Category names joined by dots | Categories with flagged key lists |
| **Clean** | "Other: N items" summary for unflagged | *(missing)* | "N items, nothing suspicious" |

**Missing from wearehere popup:** Flagged/total ratio display

---

### 7. Links (wearelinked)

| | Original wearelinked popup | wearehere popup | wearehere dashboard |
|---|---|---|---|
| **Verdict** | Domain + total tracked links + level + hint ("Look for red underlines") | Percentage or "None" | *(in Overview)* |
| **Counts** | "N redirects · N tracking tags" | Tracked/total count, redirect wrappers | Summary cards |
| **Context** | "via [domains]" for redirects, "on [domains]" for tracking | *(missing)* | *(missing)* |
| **Provider pills** | Color-coded pills: Google Analytics, Meta, Microsoft, etc. mapped from param names | *(missing)* | *(missing)* |
| **Tracked links** | *(tooltip on page — not in popup)* | *(N/A)* | Links with highlighted tracking params |
| **Tooltip toggle** | On/off toggle for page underline tooltips | *(missing)* | *(missing)* |

**Missing from wearehere:** Provider pills (Google, Meta, etc.), redirect domain context, on-page tooltip feature

---

### 8. Forms (wearesilent)

| | Original wearesilent popup | wearehere popup | wearehere dashboard |
|---|---|---|---|
| **Sent section** | "Sent without your permission" — field label + value + destination companies (grouped, with arrows) | *(missing — no leak detection)* | *(missing)* |
| **Detected section** | "Active trackers on this page" — company chips + "Active while you enter data" | "N watching" + tracker names | Tracker status + company names |
| **Field details** | Shows actual field labels: "Your Email", "Your Name" | Field count only in popup | Field name tags in dashboard |
| **Clean state** | Green "no leaks" message | "No form fields on this page" | "No form fields detected" |

**Missing from wearehere:** Real-time leak detection ("Sent without your permission" — field values being sent to trackers), field-to-destination mapping. This was the core feature of wearesilent.

---

## Work Log

<!-- Append findings here as we review each module -->
