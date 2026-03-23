/**
 * graph.js — Force-directed node graph for wearehere report dashboard.
 * Visualizes third-party network connections as an interactive graph.
 * Zero dependencies — vanilla Canvas + JS force simulation.
 */
(function () {
  'use strict';

  // ============================================================================
  // PARENT COMPANY MAP — maps root domains to owning companies
  // ============================================================================
  const PARENT_COMPANY_MAP = {
    // Google
    'doubleclick.net': 'Google', 'google-analytics.com': 'Google',
    'googlesyndication.com': 'Google', 'googleadservices.com': 'Google',
    'googletagmanager.com': 'Google', 'gstatic.com': 'Google',
    'googleapis.com': 'Google', 'youtube.com': 'Google',
    'googleusercontent.com': 'Google', 'google.com': 'Google',
    'ggpht.com': 'Google', 'googlevideo.com': 'Google',
    'admob.com': 'Google', 'recaptcha.net': 'Google',
    // Meta
    'facebook.com': 'Meta', 'facebook.net': 'Meta',
    'instagram.com': 'Meta', 'fbcdn.net': 'Meta',
    'cdninstagram.com': 'Meta', 'whatsapp.com': 'Meta',
    // Microsoft
    'adnxs.com': 'Microsoft', 'linkedin.com': 'Microsoft',
    'clarity.ms': 'Microsoft', 'bing.com': 'Microsoft',
    'msn.com': 'Microsoft', 'live.com': 'Microsoft',
    // Amazon
    'amazon-adsystem.com': 'Amazon', 'cloudfront.net': 'Amazon',
    'amazonaws.com': 'Amazon', 'amazon.com': 'Amazon',
    'awsstatic.com': 'Amazon', 'images-amazon.com': 'Amazon',
    // Oracle
    'bluekai.com': 'Oracle', 'moatads.com': 'Oracle',
    'addthis.com': 'Oracle', 'grapeshot.co.uk': 'Oracle',
    'oracleinfinity.io': 'Oracle', 'datalogix.com': 'Oracle',
    'bkrtx.com': 'Oracle',
    // Adobe
    'demdex.net': 'Adobe', 'omtrdc.net': 'Adobe',
    'typekit.net': 'Adobe',
    // Salesforce
    'krxd.net': 'Salesforce', 'salesforceliveagent.com': 'Salesforce',
    // Criteo
    'criteo.com': 'Criteo', 'criteo.net': 'Criteo',
    // Twitter/X
    'twitter.com': 'X', 'x.com': 'X', 'twimg.com': 'X',
    'ads-twitter.com': 'X', 't.co': 'X',
    // The Trade Desk
    'adsrvr.org': 'The Trade Desk', 'thetradedesk.com': 'The Trade Desk',
    // Nielsen
    'exelator.com': 'Nielsen', 'imrworldwide.com': 'Nielsen',
    'nielsen.com': 'Nielsen',
    // Lotame
    'lotame.com': 'Lotame', 'crwdcntrl.net': 'Lotame',
    // LiveRamp
    'liveramp.com': 'LiveRamp', 'rlcdn.com': 'LiveRamp',
    'pippio.com': 'LiveRamp',
    // Twilio
    'segment.io': 'Twilio', 'segment.com': 'Twilio',
    // Tealium
    'tealiumiq.com': 'Tealium', 'tiqcdn.com': 'Tealium',
    // Cloudflare
    'cloudflare.com': 'Cloudflare',
    // Akamai
    'akamaized.net': 'Akamai', 'akamai.net': 'Akamai',
  };

  // ============================================================================
  // CATEGORY COLORS
  // ============================================================================
  const CATEGORY_COLORS = {
    'Advertising': '#ff4444',
    'Analytics': '#ff8c00',
    'Social': '#a855f7',
    'Data Broker': '#ef4444',
    'Data Marketplace': '#ef4444',
    'Identity Resolution': '#f43f5e',
    'Audience Data': '#f97316',
    'Fingerprinting': '#f43f5e',
    'cdn': '#22c55e',
    'Consent': '#3b82f6',
    'Auth': '#3b82f6',
    'Chat/Support': '#8b5cf6',
    'Error Monitoring': '#64748b',
    'payment': '#10b981',
    'maps': '#06b6d4',
    'fonts': '#a1a1aa',
    'captcha': '#eab308',
    'Video/Media': '#64748b',
    'A/B Testing': '#8b5cf6',
    'Social Tracking': '#a855f7',
    'auth': '#3b82f6',
    'Other': '#666666',
    'unknown': '#666666',
  };

  var DEFAULT_COLOR = '#666666';

  // Safely append hex alpha to a color — ensures 6-char base
  function colorAlpha(color, alphaHex) {
    var c = color || DEFAULT_COLOR;
    // Expand 3-char hex to 6-char: #abc -> #aabbcc
    if (c.length === 4) {
      c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    }
    return c + alphaHex;
  }

  // ============================================================================
  // STATE
  // ============================================================================
  let canvas, ctx;
  let W = 0, H = 0, dpr = 1;
  let now = 0;
  let animFrameId = null;
  let resizeObserver = null;

  let nodes = [];
  let edges = [];
  let particles = [];

  let clusterMode = true; // on by default
  let riskMode = false;
  let searchFilter = '';
  let hoveredNode = null;
  let selectedNode = null;
  let dragNode = null;
  let dragMoved = false;

  let compareMode = false;
  let selectedCategory = null;
  let primaryData = null;
  let primarySite = '';
  let compareData = null;
  let compareSite = '';

  const SIM = {
    repulsion: 2000,
    attraction: 0.005,
    centerGravity: 0.006,
    damping: 0.88,
    minAlpha: 0.001,
    alpha: 1,
  };

  // ============================================================================
  // DATA ADAPTER — converts reportData to graph-friendly format
  // ============================================================================
  function getRootDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    return parts.slice(-2).join('.');
  }

  function extractDomain(url) {
    try { return new URL(url).hostname; } catch { return url; }
  }

  function adaptReportData(reportData) {
    const domains = {};
    // Use networkDashboard.domains — same source as the Network tab.
    // Only include domains that were third-party on at least one site
    // (exactly how the Network tab counts "3P Domains").
    var rawDomains = {};
    var dashDomains = (reportData.networkDashboard && reportData.networkDashboard.domains) || {};

    if (Object.keys(dashDomains).length > 0) {
      for (var gd in dashDomains) {
        if (!dashDomains.hasOwnProperty(gd)) continue;
        var gi = dashDomains[gd];
        var tpOn = gi.thirdPartyOn || [];
        if (tpOn.length === 0) continue;
        var cls = gi.classification || {};
        rawDomains[gd] = {
          count: gi.count || 1,
          category: (cls.category && cls.category !== 'unknown') ? cls.category : 'Other',
          risky: !!cls.risky,
          brokerName: cls.brokerName || null,
          brokerType: cls.brokerType || null,
          brokerDesc: cls.brokerDesc || null,
          bytesReceived: gi.bytesReceived || 0,
        };
      }
    } else {
      rawDomains = (reportData.network && reportData.network.domains) || {};
    }
    const rawCookies = reportData.rawCookies || [];

    // Count cookies per root domain
    const cookieCounts = {};
    for (var i = 0; i < rawCookies.length; i++) {
      var c = rawCookies[i];
      var d = (c.domain || '').replace(/^\./, '');
      var root = getRootDomain(d);
      cookieCounts[d] = (cookieCounts[d] || 0) + 1;
      if (d !== root) cookieCounts[root] = (cookieCounts[root] || 0) + 1;
    }

    for (var domain in rawDomains) {
      if (!rawDomains.hasOwnProperty(domain)) continue;
      var info = rawDomains[domain];
      var root = getRootDomain(domain);
      domains[domain] = {
        count: info.count || 1,
        category: (info.category && info.category !== 'unknown') ? info.category : 'Other',
        risky: !!info.risky,
        parent: PARENT_COMPANY_MAP[root] || PARENT_COMPANY_MAP[domain] || null,
        cookies: cookieCounts[domain] || cookieCounts[root] || 0,
        brokerName: info.brokerName || null,
        brokerType: info.brokerType || null,
        brokerDesc: info.brokerDesc || null,
        bytesReceived: info.bytesReceived || 0,
      };
    }

    // Adapt redirect chains: extract domains from full URLs
    var rawChains = (reportData.network && reportData.network.redirectChains) || [];
    var redirects = [];
    for (var i = 0; i < rawChains.length; i++) {
      var rc = rawChains[i];
      var chain = (rc.chain || []).map(extractDomain);
      // Deduplicate consecutive same-domain entries
      var deduped = [chain[0]];
      for (var j = 1; j < chain.length; j++) {
        if (chain[j] !== chain[j - 1]) deduped.push(chain[j]);
      }
      if (deduped.length > 1) redirects.push(deduped);
    }

    return { domains: domains, redirects: redirects };
  }

  // ============================================================================
  // GRAPH BUILDING
  // ============================================================================
  function stripWww(name) {
    return name.replace(/^www\./, '');
  }

  function buildGraph(siteName, data, offsetX, centerY, half) {
    var cx = offsetX;
    var cy = centerY;
    var prefix = half || '';
    var displayName = stripWww(siteName);

    // Center node
    nodes.push({
      id: prefix + siteName,
      x: cx, y: cy, vx: 0, vy: 0,
      radius: 28, color: '#ffffff', category: 'origin',
      label: displayName, fixed: true, risky: false,
      detail: 'The site you visited', mass: 4,
      visible: true, half: half,
      cookies: 0, parent: null, brokerName: null,
      brokerType: null, brokerDesc: null, count: 0,
      pulsePhase: -1,
    });

    var domainKeys = Object.keys(data.domains);
    for (var i = 0; i < domainKeys.length; i++) {
      var domain = domainKeys[i];
      var d = data.domains[domain];
      var angle = (i / domainKeys.length) * Math.PI * 2 - Math.PI / 2;
      // Scale initial spread to fill available space
      var availR = Math.min(W, H) * (compareMode ? 0.35 : 0.42);
      var dist = availR * 0.3 + Math.random() * availR * 0.7;
      // Size based on the larger of requests or cookies — avoids tiny circles with big cookie badges
      var impact = Math.max(d.count, d.cookies);
      var r = 5 + Math.min(impact, 20) * 1.0;

      nodes.push({
        id: prefix + domain,
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: 0, vy: 0,
        radius: r,
        color: CATEGORY_COLORS[d.category] || DEFAULT_COLOR,
        category: d.category,
        label: domain,
        fixed: false, risky: d.risky,
        parent: d.parent,
        brokerName: d.brokerName,
        brokerType: d.brokerType,
        brokerDesc: d.brokerDesc,
        detail: d.brokerDesc,
        count: d.count,
        cookies: d.cookies,
        bytesReceived: d.bytesReceived || 0,
        mass: 1 + d.count * 0.1,
        visible: true,
        half: half,
        pulsePhase: d.risky ? Math.random() * Math.PI * 2 : -1,
      });

      edges.push({
        source: prefix + siteName,
        target: prefix + domain,
        strength: 0.3,
        half: half,
      });
    }

    // Redirect chain edges
    var redirects = data.redirects || [];
    for (var i = 0; i < redirects.length; i++) {
      var chain = redirects[i];
      for (var j = 0; j < chain.length - 1; j++) {
        // Only add edge if both nodes exist in the graph
        if (data.domains[chain[j]] && data.domains[chain[j + 1]]) {
          edges.push({
            source: prefix + chain[j],
            target: prefix + chain[j + 1],
            strength: 0.6,
            redirect: true,
            half: half,
          });
        }
      }
    }
  }

  function rebuildAll() {
    nodes = [];
    edges = [];
    particles = [];
    selectedNode = null;
    hoveredNode = null;
    SIM.alpha = 1;

    // Offset center Y down to account for toolbar + title area
    var graphCenterY = (H + 80) / 2;
    if (compareMode && compareData && compareSite) {
      buildGraph(primarySite, primaryData, W * 0.28, graphCenterY, 'L');
      buildGraph(compareSite, compareData, W * 0.72, graphCenterY, 'R');
    } else if (primaryData && primarySite) {
      buildGraph(primarySite, primaryData, W / 2, graphCenterY, '');
    }
  }

  // ============================================================================
  // FORCE SIMULATION
  // ============================================================================
  function isFiltered(n) {
    if (!searchFilter) return false;
    if (n.category === 'origin') return false;
    var q = searchFilter.toLowerCase();
    return !(
      n.label.toLowerCase().indexOf(q) !== -1 ||
      (n.parent && n.parent.toLowerCase().indexOf(q) !== -1) ||
      (n.brokerName && n.brokerName.toLowerCase().indexOf(q) !== -1) ||
      (n.category && n.category.toLowerCase().indexOf(q) !== -1)
    );
  }

  function isVisible(n) {
    return n.visible && !isFiltered(n);
  }

  function simulate() {
    var vis = [];
    for (var i = 0; i < nodes.length; i++) {
      if (isVisible(nodes[i])) vis.push(nodes[i]);
    }
    var nodeMap = {};
    for (var i = 0; i < vis.length; i++) nodeMap[vis[i].id] = vis[i];

    // Repulsion
    for (var i = 0; i < vis.length; i++) {
      for (var j = i + 1; j < vis.length; j++) {
        var a = vis[i], b = vis[j];
        if (compareMode && a.half !== b.half) continue;
        var dx = b.x - a.x, dy = b.y - a.y;
        var dist = Math.sqrt(dx * dx + dy * dy) || 1;
        var force = SIM.repulsion / (dist * dist);
        var fx = (dx / dist) * force, fy = (dy / dist) * force;
        if (!a.fixed) { a.vx -= fx / a.mass; a.vy -= fy / a.mass; }
        if (!b.fixed) { b.vx += fx / b.mass; b.vy += fy / b.mass; }
      }
    }

    // Attraction along edges
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var a = nodeMap[e.source], b = nodeMap[e.target];
      if (!a || !b) continue;
      var dx = b.x - a.x, dy = b.y - a.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      // Scale ideal distance with canvas size
      var scale = Math.min(W, H) / 600;
      var idealDist = e.redirect ? 70 * scale : 160 * scale;
      var force = (dist - idealDist) * SIM.attraction * e.strength;
      var fx = (dx / dist) * force, fy = (dy / dist) * force;
      if (!a.fixed) { a.vx += fx; a.vy += fy; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
    }

    // Center gravity
    for (var i = 0; i < vis.length; i++) {
      var n = vis[i];
      if (n.fixed) continue;
      var cx = W / 2, cy = (H + 80) / 2;
      if (n.half === 'L') cx = W * 0.28;
      else if (n.half === 'R') cx = W * 0.72;
      n.vx += (cx - n.x) * SIM.centerGravity;
      n.vy += (cy - n.y) * SIM.centerGravity;
    }

    // Cluster force
    if (clusterMode) {
      var groups = {};
      for (var i = 0; i < vis.length; i++) {
        var n = vis[i];
        if (n.parent) {
          var key = (n.half || '') + n.parent;
          if (!groups[key]) groups[key] = [];
          groups[key].push(n);
        }
      }
      for (var key in groups) {
        var members = groups[key];
        if (members.length < 2) continue;
        var cx = 0, cy = 0;
        for (var i = 0; i < members.length; i++) { cx += members[i].x; cy += members[i].y; }
        cx /= members.length; cy /= members.length;
        for (var i = 0; i < members.length; i++) {
          if (members[i].fixed) continue;
          members[i].vx += (cx - members[i].x) * 0.04;
          members[i].vy += (cy - members[i].y) * 0.04;
        }
      }
    }

    // Integrate
    var padX = 20, padTop = 80, padBot = 30;
    for (var i = 0; i < vis.length; i++) {
      var n = vis[i];
      if (n.fixed) continue;
      n.vx *= SIM.damping;
      n.vy *= SIM.damping;
      n.x += n.vx * SIM.alpha;
      n.y += n.vy * SIM.alpha;

      var minX = padX, maxX = W - padX;
      if (compareMode) {
        if (n.half === 'L') { minX = padX; maxX = W * 0.48; }
        else if (n.half === 'R') { minX = W * 0.52; maxX = W - padX; }
      }
      n.x = Math.max(minX, Math.min(maxX, n.x));
      n.y = Math.max(padTop, Math.min(H - padBot, n.y));
    }

    SIM.alpha = Math.max(SIM.alpha * 0.998, SIM.minAlpha);
  }

  // ============================================================================
  // PARTICLES
  // ============================================================================
  function spawnParticles() {
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var a = getNode(e.source), b = getNode(e.target);
      if (!a || !b || !isVisible(a) || !isVisible(b)) continue;

      var chance = e.redirect ? 0.04 : 0.015;
      if (Math.random() > chance) continue;

      particles.push({
        sx: a.x, sy: a.y,
        tx: b.x, ty: b.y,
        t: 0,
        speed: 0.008 + Math.random() * 0.012,
        color: a.category === 'origin' ? (b.color || '#fff') : (a.color || '#fff'),
        size: e.redirect ? 2.5 : 1.5,
      });
    }

    for (var i = particles.length - 1; i >= 0; i--) {
      particles[i].t += particles[i].speed;
      if (particles[i].t >= 1) particles.splice(i, 1);
    }

    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var x = p.sx + (p.tx - p.sx) * p.t;
      var y = p.sy + (p.ty - p.sy) * p.t;
      var alpha = Math.sin(p.t * Math.PI);
      ctx.beginPath();
      ctx.arc(x, y, p.size, 0, Math.PI * 2);
      var alphaInt = Math.round(alpha * 200);
      var hex = alphaInt.toString(16);
      if (hex.length < 2) hex = '0' + hex;
      ctx.fillStyle = colorAlpha(p.color, hex);
      ctx.fill();
    }
  }

  // ============================================================================
  // CHAIN TRACING
  // ============================================================================
  function getChainNodes(nodeId) {
    var visited = {};
    visited[nodeId] = true;
    var queue = [nodeId];
    while (queue.length) {
      var cur = queue.shift();
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (!e.redirect) continue;
        var next = null;
        if (e.source === cur && !visited[e.target]) next = e.target;
        if (e.target === cur && !visited[e.source]) next = e.source;
        if (next) { visited[next] = true; queue.push(next); }
      }
    }
    return visited;
  }

  function getNodeChains(nodeId, data) {
    if (!data || !data.redirects) return [];
    var chains = [];
    var prefix = '';
    var node = getNode(nodeId);
    if (node) prefix = node.half || '';
    for (var i = 0; i < data.redirects.length; i++) {
      var chain = data.redirects[i];
      for (var j = 0; j < chain.length; j++) {
        if (prefix + chain[j] === nodeId) {
          chains.push(chain.join(' \u2192 '));
          break;
        }
      }
    }
    return chains;
  }

  function getNode(id) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return nodes[i];
    }
    return null;
  }

  // ============================================================================
  // DRAWING
  // ============================================================================
  function draw() {
    ctx.clearRect(0, 0, W, H);

    // Empty state — no connections captured
    var nonOriginNodes = nodes.filter(function(n) { return n.category !== 'origin'; });
    if (nonOriginNodes.length === 0 && !compareMode) {
      ctx.font = '14px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#666';
      ctx.fillText('No network data captured yet.', W / 2, H / 2 - 10);
      ctx.fillText('Refresh the page to start monitoring.', W / 2, H / 2 + 14);
    }

    // Compare mode divider
    if (compareMode) {
      ctx.beginPath();
      ctx.moveTo(W / 2, 10);
      ctx.lineTo(W / 2, H - 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.05)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    var nodeMap = {};
    for (var i = 0; i < nodes.length; i++) nodeMap[nodes[i].id] = nodes[i];

    // Highlight set from selected node
    var highlightSet = null;
    if (selectedNode) {
      highlightSet = getChainNodes(selectedNode.id);
      // Also include origin
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].category === 'origin' && nodes[i].half === selectedNode.half) {
          highlightSet[nodes[i].id] = true;
        }
      }
      // Include all directly connected nodes
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        if (e.source === selectedNode.id) highlightSet[e.target] = true;
        if (e.target === selectedNode.id) highlightSet[e.source] = true;
      }
      // Include all nodes from the same parent company
      if (selectedNode.parent) {
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].parent === selectedNode.parent && nodes[i].half === selectedNode.half) {
            highlightSet[nodes[i].id] = true;
          }
        }
      }
    }

    // Draw edges
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var a = nodeMap[e.source], b = nodeMap[e.target];
      if (!a || !b || !isVisible(a) || !isVisible(b)) continue;

      var isHL = highlightSet && (highlightSet[e.source] && highlightSet[e.target]);
      var dimHL = highlightSet && !isHL;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);

      if (e.redirect) {
        ctx.strokeStyle = dimHL ? 'rgba(255,68,68,0.08)' : 'rgba(255,68,68,0.3)';
        ctx.lineWidth = dimHL ? 0.5 : 1.8;
        ctx.setLineDash([4, 4]);
      } else {
        var isHov = hoveredNode && (hoveredNode.id === e.source || hoveredNode.id === e.target);
        if (dimHL) {
          ctx.strokeStyle = 'rgba(255,255,255,0.08)';
          ctx.lineWidth = 0.3;
        } else {
          ctx.strokeStyle = isHov ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.15)';
          ctx.lineWidth = isHov ? 1.8 : 0.7;
        }
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Particles
    drawParticles();

    // Draw nodes
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!isVisible(n)) continue;

      var isHov = hoveredNode === n;
      var isSel = selectedNode === n;
      var isConn = hoveredNode && false;
      if (hoveredNode) {
        for (var j = 0; j < edges.length; j++) {
          if ((edges[j].source === hoveredNode.id && edges[j].target === n.id) ||
              (edges[j].target === hoveredNode.id && edges[j].source === n.id)) {
            isConn = true; break;
          }
        }
      }
      var inChain = highlightSet && highlightSet[n.id];
      var catDimmed = selectedCategory && n.category !== selectedCategory && n.category !== 'origin';
      var dimmed = (hoveredNode && !isHov && !isConn && n.category !== 'origin')
                || (highlightSet && !inChain)
                || catDimmed;

      // Pulse
      var pulseR = 0;
      if (n.pulsePhase >= 0 && !dimmed) {
        pulseR = Math.sin(now * 0.003 + n.pulsePhase) * 0.4 + 0.6;
      }

      // Glow
      var glowColor = riskMode && n.category !== 'origin' ? (n.risky ? '#ef4444' : '#22c55e') : n.color;
      if (n.risky && !dimmed && n.x === n.x && n.y === n.y) {
        var glowSize = n.radius * (2.5 + pulseR * 1.5);
        if (glowSize > 0) {
          var grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowSize);
          grad.addColorStop(0, colorAlpha(glowColor, '25'));
          grad.addColorStop(1, colorAlpha(glowColor, '00'));
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }
      }

      // Node circle
      var drawRadius = n.radius + (pulseR > 0 && !dimmed ? pulseR * 2 : 0);
      ctx.beginPath();
      ctx.arc(n.x, n.y, drawRadius, 0, Math.PI * 2);
      // Essentials mode: override colors to green (essential) / red (non-essential)
      var nodeColor = n.color;
      if (riskMode && n.category !== 'origin') {
        nodeColor = n.risky ? '#ef4444' : '#22c55e';
      }
      ctx.fillStyle = dimmed ? colorAlpha(nodeColor, '30') : nodeColor;
      ctx.fill();

      if (isHov || isSel) {
        ctx.strokeStyle = isSel ? '#ff4444' : '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Cookie badge
      if (n.cookies > 0 && !dimmed && n.category !== 'origin') {
        var bx = n.x + n.radius * 0.7;
        var by = n.y - n.radius * 0.7;
        ctx.beginPath();
        ctx.arc(bx, by, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#ff8c00';
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = 'bold 8px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.cookies, bx, by);
        ctx.textBaseline = 'alphabetic';
      }

      // Label
      if (n.category === 'origin' || isHov || isSel) {
        ctx.fillStyle = dimmed ? '#222' : '#fff';
        ctx.font = n.category === 'origin' ? 'bold 13px system-ui' : '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + n.radius + 14);
      }
    }

    // Cluster labels + enclosing circles
    if (clusterMode) {
      var groups = {};
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!isVisible(n) || !n.parent) continue;
        var key = (n.half || '') + n.parent;
        if (!groups[key]) groups[key] = { name: n.parent, members: [] };
        groups[key].members.push(n);
      }
      for (var key in groups) {
        var g = groups[key];
        if (g.members.length < 2) continue;
        var cx = 0, cy = 0;
        for (var i = 0; i < g.members.length; i++) { cx += g.members[i].x; cy += g.members[i].y; }
        cx /= g.members.length; cy /= g.members.length;

        var maxDist = 0;
        for (var i = 0; i < g.members.length; i++) {
          var d = Math.sqrt(Math.pow(g.members[i].x - cx, 2) + Math.pow(g.members[i].y - cy, 2)) + g.members[i].radius;
          if (d > maxDist) maxDist = d;
        }
        ctx.beginPath();
        ctx.arc(cx, cy, maxDist + 10, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Cluster label with subtle background
        var labelText = g.name;
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        var labelW = ctx.measureText(labelText).width;
        var labelX = cx;
        var labelY = cy - maxDist - 14;
        ctx.fillStyle = 'rgba(10,10,15,0.6)';
        ctx.fillRect(labelX - labelW / 2 - 6, labelY - 11, labelW + 12, 16);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillText(labelText, labelX, labelY);
      }
    }

    // Compare labels
    // Subtitle helper — shows split in essentials mode
    function drawSubtitle(x, y, half) {
      var essential = 0, nonEssential = 0;
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        if (nd.category === 'origin') continue;
        if (half && nd.half !== half) continue;
        if (!half && nd.half) continue;
        if (nd.risky) nonEssential++;
        else essential++;
      }
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      if (riskMode) {
        ctx.fillStyle = '#22c55e';
        ctx.fillText(essential + ' essential', x - 50, y);
        ctx.fillStyle = '#888888';
        ctx.fillText('/', x, y);
        ctx.fillStyle = '#ef4444';
        ctx.fillText(nonEssential + ' non-essential', x + 60, y);
      } else {
        ctx.fillStyle = '#888888';
        ctx.fillText((essential + nonEssential) + ' connections', x, y);
      }
    }

    // Site titles — below the toolbar
    var titleY = compareMode ? 65 : 55;
    if (compareMode && primarySite && compareSite) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.font = 'bold 36px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('VS', W / 2, H / 2 + 12);

      var leftCount = 0, rightCount = 0;
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].half === 'L' && nodes[i].category !== 'origin') leftCount++;
        if (nodes[i].half === 'R' && nodes[i].category !== 'origin') rightCount++;
      }

      ctx.font = 'bold 18px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(stripWww(primarySite), W * 0.28, titleY);
      drawSubtitle(W * 0.28, titleY + 18, 'L');

      ctx.font = 'bold 18px system-ui';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(stripWww(compareSite), W * 0.72, titleY);
      drawSubtitle(W * 0.72, titleY + 18, 'R');
    } else if (primarySite) {
      ctx.font = 'bold 20px system-ui';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(stripWww(primarySite), W / 2, titleY);
      drawSubtitle(W / 2, titleY + 18, '');
    }
  }

  // ============================================================================
  // TOOLTIP
  // ============================================================================
  function showTooltip(n, mx, my) {
    var tip = document.getElementById('graph-tooltip');
    if (!tip) return;
    tip.style.display = 'block';

    var tx = mx + 16, ty = my - 10;
    var panel = document.getElementById('panel-graph');
    if (panel) {
      var rect = panel.getBoundingClientRect();
      if (tx + 300 > rect.right) tx = mx - 300;
      if (ty + 140 > rect.bottom) ty = my - 140;
    }
    tip.style.left = tx + 'px';
    tip.style.top = ty + 'px';

    var html = '<div class="graph-tip-domain">' + escHtml(n.label) + '</div>';

    var cat = n.category;
    if (n.parent) cat += ' \u2014 ' + n.parent;
    if (n.brokerName) cat = n.brokerName + ' (' + (n.brokerType || n.category) + ')';
    html += '<div class="graph-tip-cat">' + escHtml(cat) + '</div>';

    if (n.cookies > 0) {
      html += '<div class="graph-tip-cookies">' + n.cookies + ' cookies set</div>';
    }

    // Chain info
    var curData = n.half === 'R' ? compareData : primaryData;
    var chains = getNodeChains(n.id, curData);
    if (chains.length > 0) {
      html += '<div class="graph-tip-chain">Chain: ' + escHtml(chains[0]) + '</div>';
    }

    var detail = '';
    if (n.count) detail += n.count + ' requests';
    if (n.bytesReceived > 0) detail += ' \u00b7 ' + formatBytes(n.bytesReceived);
    if (n.detail) detail += ' \u2014 ' + n.detail;
    if (detail) html += '<div class="graph-tip-detail">' + escHtml(detail) + '</div>';

    tip.innerHTML = html;
  }

  function hideTooltip() {
    var tip = document.getElementById('graph-tooltip');
    if (tip) tip.style.display = 'none';
  }

  function escHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(1) + ' MB';
  }

  // ============================================================================
  // INFO PANEL — shown on click
  // ============================================================================
  function showInfoPanel(n) {
    var panel = document.getElementById('graph-info');
    if (!panel) return;

    var curData = n.half === 'R' ? compareData : primaryData;
    var chains = getNodeChains(n.id, curData);

    var html = '<div class="graph-info-header">';
    html += '<span class="graph-info-domain">' + escHtml(n.label) + '</span>';
    html += '<button class="graph-info-close" id="graph-info-close">\u00d7</button>';
    html += '</div>';

    html += '<div class="graph-info-row"><span class="graph-info-label">Category</span>' + escHtml(n.category) + '</div>';

    if (n.parent) {
      html += '<div class="graph-info-row"><span class="graph-info-label">Owner</span>' + escHtml(n.parent) + '</div>';
    }
    if (n.brokerName) {
      html += '<div class="graph-info-row"><span class="graph-info-label">Broker</span>' + escHtml(n.brokerName) + ' (' + escHtml(n.brokerType || '') + ')</div>';
    }
    html += '<div class="graph-info-row"><span class="graph-info-label">Requests</span>' + (n.count || 0) + '</div>';
    html += '<div class="graph-info-row"><span class="graph-info-label">Cookies</span>' + (n.cookies || 0) + '</div>';

    if (n.bytesReceived > 0) {
      html += '<div class="graph-info-row"><span class="graph-info-label">Data</span>' + formatBytes(n.bytesReceived) + '</div>';
    }

    if (chains.length > 0) {
      html += '<div class="graph-info-chains"><span class="graph-info-label">Redirect chains</span>';
      for (var i = 0; i < chains.length; i++) {
        html += '<div class="graph-info-chain">' + escHtml(chains[i]) + '</div>';
      }
      html += '</div>';
    }

    if (n.detail) {
      html += '<div class="graph-info-desc">' + escHtml(n.detail) + '</div>';
    }

    panel.innerHTML = html;
    panel.style.display = 'block';

    document.getElementById('graph-info-close').addEventListener('click', function () {
      selectedNode = null;
      panel.style.display = 'none';
    });
  }

  function hideInfoPanel() {
    var panel = document.getElementById('graph-info');
    if (panel) panel.style.display = 'none';
  }

  // ============================================================================
  // INTERACTION
  // ============================================================================
  function hitTest(mx, my) {
    for (var i = nodes.length - 1; i >= 0; i--) {
      var n = nodes[i];
      if (!isVisible(n)) continue;
      var dx = mx - n.x, dy = my - n.y;
      if (dx * dx + dy * dy < (n.radius + 6) * (n.radius + 6)) return n;
    }
    return null;
  }

  function canvasCoords(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onMouseMove(e) {
    var pos = canvasCoords(e);

    if (dragNode) {
      dragNode.x = pos.x;
      dragNode.y = pos.y;
      dragMoved = true;
      SIM.alpha = Math.max(SIM.alpha, 0.3);
      return;
    }

    var found = hitTest(pos.x, pos.y);
    hoveredNode = found;

    if (found) {
      canvas.style.cursor = 'pointer';
      showTooltip(found, e.clientX, e.clientY);
    } else {
      canvas.style.cursor = 'grab';
      hideTooltip();
    }
  }

  function onMouseDown(e) {
    dragMoved = false;
    var pos = canvasCoords(e);
    var found = hitTest(pos.x, pos.y);
    if (found) {
      dragNode = found;
      dragNode._wasFixed = dragNode.fixed;
      dragNode.fixed = true;
    }
  }

  function onMouseUp(e) {
    if (dragNode) {
      dragNode.fixed = dragNode._wasFixed;
      dragNode = null;
    }
  }

  function onClick(e) {
    if (dragMoved) return;
    var pos = canvasCoords(e);
    var found = hitTest(pos.x, pos.y);

    if (found && found.category !== 'origin') {
      if (selectedNode === found) {
        selectedNode = null;
        hideInfoPanel();
      } else {
        selectedNode = found;
        showInfoPanel(found);
      }
    } else {
      selectedNode = null;
      hideInfoPanel();
    }
  }

  function onMouseLeave() {
    hoveredNode = null;
    hideTooltip();
  }

  // ============================================================================
  // RESIZE
  // ============================================================================
  function resize() {
    var container = document.getElementById('graph-container');
    if (!container || !canvas) return;
    dpr = window.devicePixelRatio || 1;
    W = container.clientWidth;
    H = container.clientHeight;
    if (W === 0 || H === 0) return;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ============================================================================
  // LEGEND + STATS
  // ============================================================================
  function buildLegend() {
    var el = document.getElementById('graph-legend');
    if (!el) return;
    var cats = {};
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].category !== 'origin') cats[nodes[i].category] = true;
    }
    var html = '';
    for (var cat in cats) {
      var color = CATEGORY_COLORS[cat] || DEFAULT_COLOR;
      html += '<span class="graph-legend-item">';
      html += '<span class="graph-legend-dot" style="background:' + color + '"></span>';
      html += escHtml(cat) + '</span>';
    }
    el.innerHTML = html;
  }

  function updateStats() {
    var el = document.getElementById('graph-stats');
    if (!el) return;
    if (!primaryData) { el.innerHTML = ''; return; }

    // Merge categories from both datasets in compare mode
    var cats = {};
    var total = 0;
    var datasets = [primaryData];
    if (compareMode && compareData) datasets.push(compareData);
    for (var d = 0; d < datasets.length; d++) {
      var domains = datasets[d].domains;
      for (var domain in domains) {
        var cat = domains[domain].category;
        cats[cat] = (cats[cat] || 0) + 1;
        total++;
      }
    }

    var html = '<div class="graph-stat-count">' + total + '</div>';
    html += '<div class="graph-stat-label">third-party connections</div>';

    var sorted = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; });
    for (var i = 0; i < sorted.length; i++) {
      var cat = sorted[i];
      var color = CATEGORY_COLORS[cat] || DEFAULT_COLOR;
      html += '<div class="graph-stat-cat" data-cat="' + escHtml(cat) + '" style="color:' + color + ';font-size:12px;margin-top:2px;cursor:pointer">' + cats[cat] + ' ' + escHtml(cat) + '</div>';
    }
    el.innerHTML = html;

    // Bind click handlers on category items
    var catItems = el.querySelectorAll('.graph-stat-cat');
    for (var i = 0; i < catItems.length; i++) {
      catItems[i].addEventListener('click', function () {
        var cat = this.getAttribute('data-cat');
        if (selectedCategory === cat) {
          selectedCategory = null; // toggle off
        } else {
          selectedCategory = cat;
        }
        // Update visual state
        var all = el.querySelectorAll('.graph-stat-cat');
        for (var j = 0; j < all.length; j++) {
          all[j].style.opacity = (!selectedCategory || all[j].getAttribute('data-cat') === selectedCategory) ? '1' : '0.3';
        }
        SIM.alpha = Math.max(SIM.alpha, 0.3);
      });
    }
  }

  // ============================================================================
  // COMPARE MODE
  // ============================================================================
  function initCompareDropdown() {
    var select = document.getElementById('graph-compare-select');
    var btn = document.getElementById('graph-btn-compare');
    if (!select) return;

    browser.runtime.sendMessage({ type: 'getOpenTabs' }).then(function (tabs) {
      select.innerHTML = '';
      var currentId = window._wearehere ? window._wearehere.getCurrentTabId() : null;
      var otherTabs = (tabs || []).filter(function (t) { return t.id !== currentId && t.domain; });

      if (otherTabs.length === 0) {
        // No other tabs — hide compare entirely
        if (btn) btn.style.display = 'none';
        select.style.display = 'none';
        return;
      }

      // Show compare button (dropdown stays hidden until toggled)
      if (btn) btn.style.display = '';
      for (var i = 0; i < otherTabs.length; i++) {
        var opt = document.createElement('option');
        opt.value = otherTabs[i].id;
        opt.textContent = otherTabs[i].domain || 'Tab ' + otherTabs[i].id;
        select.appendChild(opt);
      }
    });
  }

  function loadCompareTab(tabId) {
    browser.runtime.sendMessage({ type: 'getFullReport', tabId: tabId }).then(function (report) {
      if (!report) return;
      compareData = adaptReportData(report);
      // Find the site name from the report
      compareSite = '';
      if (report.site) compareSite = report.site;
      if (!compareSite && report.url) {
        try { compareSite = new URL(report.url).hostname; } catch (e) {}
      }
      if (!compareSite && report.domain) compareSite = report.domain;
      if (!compareSite) compareSite = 'Tab ' + tabId;
      rebuildAll();
      buildLegend();
      updateStats();
    });
  }

  // ============================================================================
  // INIT / START / STOP
  // ============================================================================
  function buildDOM() {
    var panel = document.getElementById('panel-graph');
    if (!panel) return;

    panel.innerHTML = '' +
      '<div id="graph-container" class="graph-container">' +
        '<div class="graph-toolbar">' +
          '<input type="text" id="graph-search" placeholder="Filter: Google, Meta, broker...">' +
          '<button class="graph-btn active" id="graph-btn-cluster">Cluster</button>' +
          '<button class="graph-btn" id="graph-btn-risk">Essentials</button>' +
          '<button class="graph-btn" id="graph-btn-compare" style="display:none">Compare</button>' +
          '<select id="graph-compare-select" style="display:none"></select>' +
        '</div>' +
        '<div class="graph-stats-box" id="graph-stats"></div>' +
        '<canvas id="graph-canvas"></canvas>' +
        '<div id="graph-tooltip" class="graph-tooltip"></div>' +
        '<div id="graph-info" class="graph-info"></div>' +
        '<div id="graph-legend" class="graph-legend"></div>' +
      '</div>';
  }

  function bindControls() {
    var searchEl = document.getElementById('graph-search');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        searchFilter = this.value.trim();
        SIM.alpha = Math.max(SIM.alpha, 0.3);
      });
    }

    var clusterBtn = document.getElementById('graph-btn-cluster');
    if (clusterBtn) {
      clusterBtn.addEventListener('click', function () {
        clusterMode = !clusterMode;
        this.classList.toggle('active', clusterMode);
        SIM.alpha = 1;
      });
    }

    var riskBtn = document.getElementById('graph-btn-risk');
    if (riskBtn) {
      riskBtn.addEventListener('click', function () {
        riskMode = !riskMode;
        this.classList.toggle('active', riskMode);
        SIM.alpha = 0.8;
      });
    }

    var compareBtn = document.getElementById('graph-btn-compare');
    if (compareBtn) {
      compareBtn.addEventListener('click', function () {
        compareMode = !compareMode;
        this.classList.toggle('active', compareMode);
        var sel = document.getElementById('graph-compare-select');
        if (sel) sel.style.display = compareMode ? '' : 'none';

        if (compareMode) {
          // Load the currently selected tab in dropdown
          if (sel && sel.value) {
            loadCompareTab(parseInt(sel.value));
          }
        } else {
          // Exit compare mode
          compareData = null;
          compareSite = '';
          rebuildAll();
          buildLegend();
          updateStats();
          SIM.alpha = 1;
        }
      });
    }

    var compareSelect = document.getElementById('graph-compare-select');
    if (compareSelect) {
      compareSelect.addEventListener('change', function () {
        var tabId = parseInt(this.value);
        if (tabId && compareMode) {
          loadCompareTab(tabId);
        }
      });
    }
  }

  function bindCanvas() {
    canvas = document.getElementById('graph-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('mouseup', onMouseUp);
  }

  function init(reportData) {
    buildDOM();
    bindCanvas();
    bindControls();

    // Set up resize observer
    var container = document.getElementById('graph-container');
    if (container && typeof ResizeObserver !== 'undefined') {
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(function () {
        resize();
        if (nodes.length > 0) SIM.alpha = Math.max(SIM.alpha, 0.1);
      });
      resizeObserver.observe(container);
    }

    resize();
    buildFromData(reportData);
    initCompareDropdown();
  }

  function buildFromData(reportData) {
    if (!reportData) return;

    primaryData = adaptReportData(reportData);
    primarySite = '';
    if (reportData.site) primarySite = reportData.site;
    if (!primarySite && reportData.url) {
      try { primarySite = new URL(reportData.url).hostname; } catch (e) {}
    }
    if (!primarySite && reportData.domain) primarySite = reportData.domain;
    if (!primarySite) primarySite = 'Current site';

    if (!compareMode) {
      compareData = null;
      compareSite = '';
    }

    rebuildAll();
    buildLegend();
    updateStats();
  }

  function start(reportData) {
    // Double rAF to ensure layout is fully settled after display:block
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        resize();
        // Always rebuild when starting — panel was hidden during init
        // so nodes were positioned at 0,0
        if (reportData) buildFromData(reportData);
        else if (primaryData) rebuildAll();
        if (!animFrameId) loop();
      });
    });
  }

  function stop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  function loop(timestamp) {
    now = timestamp || 0;
    if (W > 0 && H > 0 && nodes.length > 0) {
      simulate();
      spawnParticles();
      draw();
    }
    animFrameId = requestAnimationFrame(loop);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================
  window.WeAreHereGraph = {
    init: init,
    start: start,
    stop: stop,
  };

})();
