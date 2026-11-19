"use strict";

// Shared scanner - used by content.js (direct) and background.js (fetched)
// scanText(text) -> { items: [{pattern, count}], score: number, total: number }
//
// Text is normalised once here (lowercase, HTML entities, curly quotes,
// dashes), so callers may pass raw or lightly stripped text. Every quantifier
// is bounded; patterns marked neg:true are skipped when a negation word sits
// in the preceding ~45 chars of the same sentence; `after` suppresses a hit
// when the text right after it promises notice.

var TOS_NEG = /\b(?:not|never|no|nor|neither|without|cannot|won't|don't|doesn't|didn't|isn't)\b|n't\b/;
var TOS_W = "(?:\\w+\\s+)";

function tosNormalize(t) {
  return t.toLowerCase()
    .replace(/&(?:rsquo|lsquo|#x27|#39|#8217|#8216);/g, "'")
    .replace(/&(?:rdquo|ldquo|#8221|#8220|quot);/g, '"')
    .replace(/&(?:mdash|ndash|#8211|#8212);/g, "-")
    .replace(/&#x?[0-9a-f]+;|&[a-z]+;/g, " ")
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, "-");
}

var TOS_SCANNERS = {
  "data-sharing": [
    // sell / rent / monetise personal data  (negation-guarded)
    { re: /\b(?:sell|sells|sold|selling|rent|rents|renting|trade|trading|monetiz\w+|monetis\w+)\s+(?:or\s+(?:share|rent|trade|license)\s+)?(?:\w+\s+){0,2}?(?:personal\s+)?(?:data|information|info|details|identifiers)\b/, neg: true },
    { re: /\bsale\s+(?:or\s+sharing\s+)?of\s+(?:your\s+|user\s+)?(?:personal\s+)?(?:data|information)|\bsold\s+or\s+shared\b|\bsell\s+or\s+share\b|\bdata\s+brokers?\b/, neg: true },
    { re: /\b(?:may|can|will|do|does)\s+(?:also\s+)?sell\b/, neg: true },
    // share / disclose / provide / transfer data with third parties etc. (not bare "service providers")
    { re: new RegExp("\\b(?:shar(?:e|es|ed|ing)|disclos(?:e|es|ed|ing)|provid(?:e|es|ed|ing)|transfer(?:s|red|ring)?|mak(?:e|es|ing)\\s+available|giv(?:e|es|ing)|send(?:s|ing)?|licen[sc](?:e|es|ing))\\s+" + TOS_W + "{0,3}?(?:personal\\s+)?(?:data|information|info|identifiers?|details|content)\\s+" + TOS_W + "{0,3}?(?:with|to)\\s+" + TOS_W + "{0,3}?(?:third[\\s-]*part(?:y|ies)|partners?|affiliates?|advertis\\w+|marketers?|ad\\s+networks?|data\\s+brokers?|business\\s+partners|social\\s+media|analytics\\s+providers?|other\\s+companies)"), neg: true },
    { re: /\b(?:third[\s-]*part(?:y|ies)|partners?)\s+(?:\w+\s+){0,2}?(?:advertis\w+|marketing|analytics|tracking|ad\s+networks?)\b|\b(?:advertis\w+|marketing|ad)\s+(?:partners?|networks?|vendors?|technology\s+vendors?)\b/, neg: true }
  ],
  "surveillance": [
    { re: /\b(?:track|tracks|tracked|tracking|follow|recogni[sz]e|identify|link|match)\s+(?:you|your\s+\w+|users?|individuals)\s+(?:across|between|over|on\s+other)\b/, neg: true },
    { re: /\bacross\s+(?:other\s+|third[\s-]party\s+)?(?:websites?|sites?|devices?|apps?|platforms?|services)\b[^.]{0,40}\b(?:track|profile|identif|advertis|recogni)/, neg: true },
    { re: /\bcross[-\s]?(?:device|site|context|app|platform)\s+(?:track|identif|profil|behavio|advertis)\w*/, neg: true },
    { re: /\b(?:build|builds|building|creat\w+|develop\w+|infer\w*)\s+(?:an?\s+|detailed\s+|user\s+)*(?:profiles?|inferences?|segments?)\s+(?:about|of|from|based|on)\b/, neg: true },
    { re: /\bfingerprint\w*\b|\bsession\s+replay\b|\bkeystroke\s+(?:log|record|captur)\w*/, neg: true },
    { re: /\b(?:web\s*beacons?|tracking\s*pixels?|clear\s*gifs?|pixel\s+tags?|pixels?\s+(?:or|and)\s+beacons?)\b/, neg: false },
    { re: /\b(?:targeted|interest[-\s]based|personali[sz]ed|behaviou?ral|cross[-\s]context\s+behaviou?ral)\s+(?:advertis\w+|ads?\b|marketing)/, neg: true },
    { re: /\b(?:advertising|ad)\s+(?:id|identifier)s?\b|\bdevice\s+identifiers?\b/, neg: true },
    { re: /\bcollect\w*\s+(?:your\s+)?(?:\w+\s+)?(?:browsing|search|viewing)\s+(?:history|activit\w+|data|habits?)|\bmonitor\w*\s+(?:your\s+)?(?:online\s+)?(?:activit\w+|behaviou?r|usage)\b/, neg: true },
    { re: /\b(?:precise|exact|real[-\s]time)\s+(?:geo)?location\b/, neg: true }
  ],
  "retention": [
    { re: /\b(?:indefinite(?:ly)?|forever|in\s+perpetuity|permanently)\b[^.]{0,40}\b(?:retain|keep|store|hold)|\b(?:retain|keep|store|hold|preserve)\w*\b[^.]{0,60}\b(?:indefinite(?:ly)?|forever|in\s+perpetuity)\b/, neg: true },
    { re: /\b(?:retain|keep|store|preserve|hold)\w*\s+(?:\w+\s+){0,5}?(?:after|following)\s+(?:you\s+|your\s+)?(?:\w+\s+){0,2}?(?:delet|clos|terminat|deactivat|cancel)\w*/, neg: true },
    { re: /\bno\s+obligation\s+to\s+(?:delete|remove|erase)\b/, neg: false },
    { re: /\bas\s+long\s+as\s+(?:we|the\s+company)\s+(?:\w+\s+){0,2}?(?:deem|consider|determine|see\s+fit|wish|choose)\b/, neg: true },
    { re: /\beven\s+(?:if|after)\s+you\s+(?:delet|clos|terminat|deactivat|cancel)\w*/, neg: true },
    { re: /\b(?:backup|archiv\w+)\s+(?:copies|copy|systems?)\b[^.]{0,80}\b(?:remain|retain|persist|may\s+(?:still\s+)?(?:contain|exist))/, neg: true }
  ],
  "law-enforcement": [
    { re: /\b(?:disclos\w*|provid\w*|shar\w*|respond\w*|compl\w+|produc\w+|turn\w*\s+over|releas\w+)\b[^.]{0,80}\b(?:law\s+enforcement|subpoenas?|warrants?|court\s+orders?|governmental?\s+(?:request|authorit|agenc|demand|order|entit)\w*|legal\s+process|national\s+security|public\s+authorit\w+|regulators?)\b/, neg: true },
    { re: /\blaw\s+enforcement\s+(?:request|agenc|authorit|official|demand)\w*|\bnational\s+security\b|\bgovernment\s+(?:request|inquir|demand|order)\w*/, neg: true }
  ],
  "rights-erosion": [
    { re: /\b(?:mandatory|binding|final|individual)\s+arbitration\b|\barbitration\s+(?:agreement|clause|provision)s?\b|\bagree\s+to\s+(?:binding\s+)?arbitrat\w+|\b(?:disputes?|claims?|controvers\w+)\b[^.]{0,100}\b(?:resolved|settled|decided|determined)\s+(?:exclusively\s+|finally\s+)?(?:by|through|in|via)\s+(?:binding\s+)?(?:individual\s+)?arbitration|\b(?:instead\s+of|rather\s+than)\s+(?:going\s+to\s+)?(?:court|jury|a\s+jury)/, neg: true },
    { re: /\bclass[-\s]?action\b|\bclass[-\s]?wide\b|\brepresentative\s+(?:action|proceeding|capacity)s?\b|\bcollective\s+action\b|\b(?:on|in)\s+an?\s+individual\s+(?:basis|capacity)\b|\b(?:individual|personal)\s+(?:basis|capacity)\b[^.]{0,40}\bnot\s+as\s+a\s+(?:plaintiff|class)/, neg: true },
    { re: /\bwaiv(?:e|es|ed|ing|er)\s+(?:\w+\s+){0,3}?(?:right|claim|ability|objection|jury)s?\b|\bjury[-\s]trial\s+waiver\b|\bno\s+jury\b|\bgive\s+up\s+(?:your\s+)?(?:right|claim)|\brelinquish\s+(?:your\s+)?(?:right|claim)/, neg: true },
    { re: /\b(?:in\s+no\s+event|under\s+no\s+circumstances)\b[^.]{0,80}\b(?:liab|responsib)\w*|\b(?:total|aggregate|maximum|entire)\s+(?:cumulative\s+)?liabilit\w+[^.]{0,80}\b(?:exceed|limited|shall\s+not|will\s+not)|\blimitations?\s+of\s+liabilit\w+/, neg: false },
    { re: /\b(?:shall|will|can|do|does)\s+not\s+be\s+(?:held\s+)?(?:liable|responsible)\s+(?:for|to)\b|\bdisclaim\w*\s+(?:\w+\s+){0,3}?(?:warrant|liabilit|responsibilit)|\bwithout\s+warrant(?:y|ies)\b|\bno\s+warrant(?:y|ies)\b/, neg: false },
    { re: /(?:provided|provide|offered|supplied|delivered|available|services?)\s+(?:to\s+you\s+)?(?:on\s+)?(?:an?\s+)?['"]?as[-\s]is\b|['"]as[-\s]is['"]|\bas[-\s]available\b/, neg: false },
    // broad content licence (non- guard for EULA software grants)
    { re: /\b(?:worldwide|perpetual|irrevocable|royalty[-\s]free|(?<!non[-\s])sublicens\w+)\b[^.]{0,90}\blicen[sc]e\b[^.]{0,220}\b(?:content|submissions?|materials?|posts?)\b|\blicen[sc]e\b[^.]{0,90}\b(?:worldwide|perpetual|irrevocable|royalty[-\s]free|(?<!non[-\s])sublicens\w+)[^.]{0,220}\b(?:content|submissions?|materials?|posts?)\b|\b(?:your\s+content|user\s+content|submissions?)\b[^.]{0,100}\b(?:worldwide|perpetual|irrevocable)\b[^.]{0,40}\blicen[sc]e/, neg: false }
  ],
  "unilateral-control": [
    { re: /\b(?:modif|chang|updat|revis|amend|alter)\w*\s+(?:\w+\s+){0,3}?(?:terms|polic(?:y|ies)|agreement|notice|these)\b[^.]{0,60}\b(?:at\s+any\s+time|(?:in|at)\s+(?:our|its)\s+(?:sole\s+)?discretion|without\s+(?:prior\s+|advance\s+)?(?:notice|notification))/, neg: false, after: /\b(?:we(?:'ll|\s+will)|will)\s+(?:\w+\s+){0,3}?(?:notify|notice|inform|email|provide\s+notice)|prior\s+notice|days'?\s+(?:prior\s+)?notice/ },
    { re: /\breserves?\s+the\s+right\s+to\s+(?:review\s+and\s+)?(?:modify|change|update|amend|revise|alter)/, neg: false, after: /\b(?:we(?:'ll|\s+will)|will)\s+(?:\w+\s+){0,3}?(?:notify|notice|inform|email|provide\s+notice)|prior\s+notice|days'?\s+(?:prior\s+)?notice/ },
    { re: /\bwithout\s+(?:prior\s+|advance\s+)?notice(?:\s+to\s+you)?\b/, neg: false },
    { re: /\b(?:sole|absolute|unfettered)(?:\s+(?:and|or)\s+(?:absolute|exclusive|sole))?\s+discretion\b/, neg: false },
    { re: /\b(?:may|can|reserves?\s+the\s+right\s+to|right\s+to)\s+(?:(?:modify|suspend|terminat\w*|disabl\w*|restrict|deactivat\w*|cancel|revok\w*|remov\w*|discontinu\w*|limit|delet\w*)[,\s]+(?:or\s+|and\s+)?){1,4}(?:\w+\s+){0,3}?(?:your\s+|any\s+)?(?:accounts?|access|use|services?|content)\b[^.]{0,80}\b(?:at\s+any\s+time|for\s+any\s+reason|any\s+or\s+no\s+reason|without\s+(?:prior\s+)?(?:notice|cause|reason|liability)|(?:in|at)\s+(?:our|its)\s+(?:sole\s+)?discretion|anytime)/, neg: false },
    { re: /\b(?:continu\w+\s+(?:to\s+)?(?:use|access)\w*|by\s+continuing\s+to\s+(?:use|access))\b[^.]{0,100}\b(?:accept|agree|consent|bound)\w*/, neg: false },
    { re: /\bdeemed\s+(?:to\s+have\s+)?(?:accepted|(?:your\s+)?(?:acceptance|consent|agreement))/, neg: false }
  ]
};

// Headline clauses (+10 each): [category, pattern index] - sale of data,
// cross-site tracking, retention after delete, arbitration, class waiver,
// broad content licence.
var TOS_HEADLINES = {
  "data-sharing": [0, 1, 2],
  "surveillance": [0, 1, 2],
  "retention": [1],
  "rights-erosion": [0, 1, 7]
};

var TOS_COMPILED = null;
function tosCompile() {
  TOS_COMPILED = {};
  for (var c in TOS_SCANNERS) {
    TOS_COMPILED[c] = TOS_SCANNERS[c].map(function (p) {
      return { p: p, re: new RegExp(p.re.source, "g") };
    });
  }
}

// Core pass: returns per-category counts, headline hits and match context.
function tosScanCore(text) {
  if (!TOS_COMPILED) tosCompile();
  var t = tosNormalize(text);
  var counts = {}, seen = {}, heads = {}, detail = [];
  for (var c in TOS_SCANNERS) counts[c] = 0;
  for (var c2 in TOS_COMPILED) {
    TOS_COMPILED[c2].forEach(function (e, pi) {
      var p = e.p, re = e.re, m;
      re.lastIndex = 0;
      while ((m = re.exec(t))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        if (p.neg) {
          var pre = t.slice(Math.max(0, m.index - 45), m.index).split(/[.;]/).pop();
          if (TOS_NEG.test(pre) || TOS_NEG.test(m[0].slice(0, 18))) continue;
        }
        if (p.after && p.after.test(t.slice(m.index + m[0].length, m.index + m[0].length + 140))) continue;
        var key = c2 + ":" + m[0].slice(0, 40);
        if (seen[key]) continue;
        seen[key] = true;
        counts[c2]++;
        if (TOS_HEADLINES[c2] && TOS_HEADLINES[c2].indexOf(pi) !== -1) heads[c2 + pi] = true;
        detail.push({ c: c2, p: pi, m: t.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40) });
      }
    });
  }
  return { counts: counts, heads: heads, detail: detail };
}

function scanText(text) {
  var core = tosScanCore(text);
  var items = [], total = 0, score = 0;
  for (var k in core.counts) {
    var n = core.counts[k];
    if (n > 0) {
      items.push({ pattern: k, count: n });
      total += n;
      // Breadth 8 per category; depth +2 per hit capped at 3 hits.
      score += 8 + 2 * Math.min(3, n);
      // Law-enforcement language is routine: discount it by a flat 10
      // (tiers2 scoring), so it barely moves the score on its own.
      if (k === "law-enforcement") score -= 10;
    }
  }
  score += 10 * Object.keys(core.heads).length;
  return { items: items, score: Math.min(100, score), total: total };
}
