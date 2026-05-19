"use strict";

(function () {
  // --- wearewatched: fingerprinting + permission wrappers ---

  // Flip to true and reload the extension to surface [wh-farble]
  // diagnostics in the page console. Off by default — wrappers fire
  // on every canvas/WebGL/audio call and would flood real-page logs.
  var DEBUG = false;

  var MSG_TYPE = "__wearewatched__";

  // Walk the stack to find the first non-extension, non-self frame —
  // that's the script that called the API. We pass its host up to
  // detect-watched.js so background.js can resolve it to a company.
  // Stack format (Chrome): "    at fn (url:line:col)"
  // Inline scripts show as "(https://page.com/path:L:C)".
  function callerHost() {
    try {
      var stack = new Error().stack;
      if (!stack) return null;
      var lines = stack.split("\n");
      for (var i = 0; i < lines.length; i++) {
        var m = /\(?((?:https?|file|blob):[^)\s]+)\)?$/.exec(lines[i]);
        if (!m) continue;
        var url = m[1];
        if (url.indexOf("chrome-extension://") === 0) continue;
        try {
          var h = new URL(url).hostname;
          if (h) return h;
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  function notify(api, category) {
    try {
      window.postMessage({
        type: MSG_TYPE,
        api: api,
        category: category,
        script: callerHost(),
        timestamp: Date.now()
      }, "*");
    } catch (e) {}
  }

  // Capture original canvas readback APIs at IIFE top, before any wrappers
  // are installed. farbleAnyCanvas must use the ORIGINAL getImageData —
  // calling our wrapper from inside farbling causes double-perturbation
  // (same seed, same offsets, XOR twice = back to original).
  var ORIG_GET_IMAGE_DATA = CanvasRenderingContext2D.prototype.getImageData;

  // Brand-true receiver guards. creepjs and similar detection harnesses probe
  // for extension instrumentation by calling these prototype methods with a
  // non-canvas receiver (e.g. `HTMLCanvasElement.prototype.toBlob.call({})`).
  // Native throws TypeError; we must too, with nothing observable in between.
  // Object.prototype.toString brand survives cross-realm (parent vs iframe).
  function isCanvas(x) {
    try { return Object.prototype.toString.call(x) === "[object HTMLCanvasElement]"; }
    catch (e) { return false; }
  }
  function isCanvas2DCtx(x) {
    try { return Object.prototype.toString.call(x) === "[object CanvasRenderingContext2D]"; }
    catch (e) { return false; }
  }
  function isOffscreenCanvas(x) {
    try {
      if (typeof OffscreenCanvas === "undefined") return false;
      return Object.prototype.toString.call(x) === "[object OffscreenCanvas]";
    } catch (e) { return false; }
  }
  function isAudioBuffer(x) {
    try { return Object.prototype.toString.call(x) === "[object AudioBuffer]"; }
    catch (e) { return false; }
  }
  function isAnalyserNode(x) {
    try { return Object.prototype.toString.call(x) === "[object AnalyserNode]"; }
    catch (e) { return false; }
  }

  // Size gates. Below FARBLE_MIN_PIXELS (32×32): font/emoji/rect detection
  // probes (1×1, 2×2, 8×8) that aggregate trivially and aren't fingerprintable
  // in isolation — wasting ~100 wrapper calls per page perturbing them is pure
  // overhead. Threshold set to 1024 (not 4096) after M4.1 testing showed
  // creepjs's primary canvas2d test uses 40×40 / 50×50 canvases (1600 / 2500
  // px) — must stay above gate. Above FARBLE_MAX_PIXELS (1024×1024): legit
  // exports/screenshots/video frames; real fingerprinters use 50×20 to 500×500
  // because larger canvases are too slow for high-rate probing. Skipping both
  // ends preserves the privacy-relevant middle band and cuts CPU on the rest.
  var FARBLE_MIN_PIXELS = 1024;
  var FARBLE_MAX_PIXELS = 1048576;
  function withinFarbleSize(w, h) {
    var area = (w >>> 0) * (h >>> 0);
    return area >= FARBLE_MIN_PIXELS && area <= FARBLE_MAX_PIXELS;
  }

  // Deterministic perturbation pattern: xorshift32 chain seeded from the
  // per-origin farble seed produces 100 pseudo-random pixel positions.
  // Same seed → same sequence → same positions (A/B determinism holds).
  // Anti-averaging hardening vs the prior fixed-stride form: positions are
  // unpredictable to a fingerprinter, so averaging multiple readbacks
  // can't filter out our XOR perturbations (every reading is identical
  // anyway — deterministic per origin — so the "median" is the perturbed
  // value, not the truth). Same flipped count + same byte op preserves
  // the visual-identity guarantee.
  var PERTURB_COUNT = 100;
  function applyFarble(data, seed) {
    var s = (seed >>> 0) || 1; // xorshift32 requires non-zero state
    var len = data.length >>> 2; // pixel count
    var flipped = 0;
    for (var i = 0; i < PERTURB_COUNT; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      var byteOffset = ((s >>> 0) % len) * 4;
      if (byteOffset + 2 < data.length) {
        data[byteOffset]     = data[byteOffset]     ^ 1;
        data[byteOffset + 1] = data[byteOffset + 1] ^ 1;
        data[byteOffset + 2] = data[byteOffset + 2] ^ 1;
        flipped++;
      }
    }
    return flipped;
  }

  // Audio perturbation helpers (M5). Same xorshift32 chain as canvas
  // applyFarble — 100 sample positions per call, deterministic per seed
  // (A/B determinism + anti-averaging). Float32: additive ±0.0001 noise,
  // far below typical 16-bit PCM step (~3e-5) cumulative dither floor and
  // inaudible in real audio. Uint8 (analyser byte data, range 0–255):
  // XOR 1 on low bit — 1/256 ≈ 0.39% — invisible in EQ visualizers.
  var AUDIO_FLOAT_MAGNITUDE = 0.0001;
  function applyFarbleFloat32(arr, seed) {
    var s = (seed >>> 0) || 1;
    var len = arr.length;
    if (len === 0) return 0;
    var flipped = 0;
    for (var i = 0; i < PERTURB_COUNT; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      var idx = (s >>> 0) % len;
      var sign = (s & 1) ? 1 : -1;
      arr[idx] = arr[idx] + sign * AUDIO_FLOAT_MAGNITUDE;
      flipped++;
    }
    return flipped;
  }
  function applyFarbleUint8(arr, seed) {
    var s = (seed >>> 0) || 1;
    var len = arr.length;
    if (len === 0) return 0;
    var flipped = 0;
    for (var i = 0; i < PERTURB_COUNT; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      var idx = (s >>> 0) % len;
      arr[idx] = arr[idx] ^ 1;
      flipped++;
    }
    return flipped;
  }

  // Farble any canvas (2D, WebGL, WebGL2, OffscreenCanvas). Returns an
  // offscreen 2D canvas containing the perturbed image, or null if
  // farbling is not possible. The drawImage indirection means we no
  // longer require the source to hold a 2D context — WebGL canvases
  // whose framebuffer would otherwise pass through toDataURL/toBlob
  // unfarbled are now covered uniformly.
  function farbleAnyCanvas(src, seed) {
    try {
      var w = src.width, h = src.height;
      if (w <= 0 || h <= 0) { DEBUG && console.log("[wh-farble] zero-size", w, h); return null; }
      if (!withinFarbleSize(w, h)) {
        DEBUG && console.log("[wh-farble] skip size " + w + "x" + h + " (out of " + FARBLE_MIN_PIXELS + "–" + FARBLE_MAX_PIXELS + " px gate)");
        return null;
      }
      var off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      var ctx = off.getContext("2d", { willReadFrequently: true });
      if (!ctx) { DEBUG && console.log("[wh-farble] no offscreen 2d ctx"); return null; }
      try { ctx.drawImage(src, 0, 0); }
      catch (e) { DEBUG && console.log("[wh-farble] drawImage failed:", e.message || e); return null; }
      // Use captured original to avoid recursing into our own wrapper,
      // which would double-perturb (and XOR-cancel) the same bytes.
      var imgData = ORIG_GET_IMAGE_DATA.call(ctx, 0, 0, w, h);
      var flipped = applyFarble(imgData.data, seed);
      ctx.putImageData(imgData, 0, 0);
      DEBUG && console.log("[wh-farble] canvas " + w + "x" + h + " seed=" + (seed >>> 0).toString(16) + " flipped=" + flipped + " pixels (×3 bytes each)");
      return off;
    } catch (e) { DEBUG && console.log("[wh-farble] error:", e.message || e); return null; }
  }

  // Perturb pixels in-place on an ImageData object using the seeded pattern.
  function perturbImageData(imgData, seed) {
    try {
      if (!withinFarbleSize(imgData.width, imgData.height)) {
        DEBUG && console.log("[wh-farble] skip perturb " + imgData.width + "x" + imgData.height + " (out of " + FARBLE_MIN_PIXELS + "–" + FARBLE_MAX_PIXELS + " px gate)");
        return;
      }
      var flipped = applyFarble(imgData.data, seed);
      DEBUG && console.log("[wh-farble] perturbed " + imgData.width + "x" + imgData.height + " seed=" + (seed >>> 0).toString(16) + " flipped=" + flipped + " pixels (×3 bytes each)");
    } catch (e) { DEBUG && console.log("[wh-farble] perturb error:", e.message || e); }
  }

  // 1a. Canvas fingerprinting — toDataURL (PNG/JPEG base64)
  var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    if (!isCanvas(this)) return origToDataURL.apply(this, arguments);
    notify("Canvas.toDataURL", "fingerprint");
    var state = farbleState();
    DEBUG && console.log("[wh-farble] toDataURL called, state=" + state);
    if (state !== "off") {
      var off = farbleAnyCanvas(this, farbleSeed());
      if (off) return origToDataURL.apply(off, arguments);
    }
    return origToDataURL.apply(this, arguments);
  };

  // 1b. Canvas fingerprinting — toBlob (async, returns Blob via callback)
  var origToBlob = HTMLCanvasElement.prototype.toBlob;
  if (origToBlob) {
    HTMLCanvasElement.prototype.toBlob = function () {
      if (!isCanvas(this)) return origToBlob.apply(this, arguments);
      notify("Canvas.toBlob", "fingerprint");
      var state = farbleState();
      DEBUG && console.log("[wh-farble] toBlob called, state=" + state);
      if (state !== "off") {
        var off = farbleAnyCanvas(this, farbleSeed());
        if (off) return origToBlob.apply(off, arguments);
      }
      return origToBlob.apply(this, arguments);
    };
  }

  // 1c. Canvas fingerprinting — getImageData (raw pixel readback)
  var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function () {
    if (!isCanvas2DCtx(this)) return origGetImageData.apply(this, arguments);
    notify("Canvas.getImageData", "fingerprint");
    var state = farbleState();
    DEBUG && console.log("[wh-farble] getImageData called, state=" + state);
    var imgData = origGetImageData.apply(this, arguments);
    if (state !== "off" && imgData) perturbImageData(imgData, farbleSeed());
    return imgData;
  };

  // 2. WebGL fingerprinting — getParameter
  // Tier A constant lies for WEBGL_debug_renderer_info (the extension
  // fingerprinters use to pull GPU vendor + driver string). Other pname
  // queries fall through to the real implementation — those are legit
  // WebGL feature/capability queries and lying about them breaks pages.
  // Same helper wraps WebGL1 and WebGL2 prototypes — pages can request
  // either context type; we close both surfaces.
  var UNMASKED_VENDOR_WEBGL   = 0x9245;
  var UNMASKED_RENDERER_WEBGL = 0x9246;
  var FARBLE_WEBGL_VENDOR   = "Google Inc. (Intel)";
  var FARBLE_WEBGL_RENDERER = "ANGLE (Intel, Intel(R) Iris Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)";

  function wrapGetParameter(proto, label, brand) {
    var orig = proto.getParameter;
    proto.getParameter = function (pname) {
      if (Object.prototype.toString.call(this) !== brand) return orig.apply(this, arguments);
      notify("WebGL.getParameter", "fingerprint");
      if (farbleState() !== "off") {
        if (pname === UNMASKED_RENDERER_WEBGL) {
          DEBUG && console.log("[wh-farble] " + label + " getParameter UNMASKED_RENDERER → farbled");
          return FARBLE_WEBGL_RENDERER;
        }
        if (pname === UNMASKED_VENDOR_WEBGL) {
          DEBUG && console.log("[wh-farble] " + label + " getParameter UNMASKED_VENDOR → farbled");
          return FARBLE_WEBGL_VENDOR;
        }
      }
      return orig.apply(this, arguments);
    };
  }
  wrapGetParameter(WebGLRenderingContext.prototype, "webgl1", "[object WebGLRenderingContext]");
  if (typeof WebGL2RenderingContext !== "undefined") {
    wrapGetParameter(WebGL2RenderingContext.prototype, "webgl2", "[object WebGL2RenderingContext]");
  }

  // 2b. WebGL fingerprinting — readPixels (direct framebuffer readback)
  // farbleAnyCanvas catches WebGL via toDataURL/toBlob (drawImage roundtrip),
  // but modern fingerprinters skip the encode and call readPixels directly
  // into a typed array. Cloudflare bot detection and FingerprintJS Pro both
  // use this path. We perturb the buffer in place after the original fills
  // it, same applyFarble pattern used for ImageData.
  //
  // Constraints: applyFarble assumes 4 bytes per pixel (RGBA +
  // UNSIGNED_BYTE) for its pixel-count math. Other formats (RGB = 3 bytes/px,
  // FLOAT = 16 bytes/px, HALF_FLOAT, INT) would index past valid pixels
  // or split mid-channel — skip them rather than mis-perturb (corrupting
  // a FLOAT depth buffer breaks games).
  // WebGL2 PIXEL_PACK_BUFFER variant (7th arg = GLintptr offset, not a
  // buffer) writes to GPU memory we can't touch from JS — also skip.
  var GL_RGBA = 0x1908;
  var GL_UNSIGNED_BYTE = 0x1401;

  function wrapReadPixels(proto, label, brand) {
    var orig = proto.readPixels;
    if (!orig) return;
    proto.readPixels = function (x, y, width, height, format, type, pixels) {
      if (Object.prototype.toString.call(this) !== brand) return orig.apply(this, arguments);
      notify("WebGL.readPixels", "fingerprint");
      var ret = orig.apply(this, arguments);
      var state = farbleState();
      if (state === "off") return ret;
      // PIXEL_PACK_BUFFER offset variant (WebGL2): can't farble GPU memory.
      if (typeof pixels !== "object" || !pixels || typeof pixels.length !== "number") {
        DEBUG && console.log("[wh-farble] " + label + " readPixels skip (no JS buffer)");
        return ret;
      }
      // Only RGBA + UNSIGNED_BYTE matches the 4-byte stride.
      if (format !== GL_RGBA || type !== GL_UNSIGNED_BYTE) {
        DEBUG && console.log("[wh-farble] " + label + " readPixels skip format=0x" + (format >>> 0).toString(16) + " type=0x" + (type >>> 0).toString(16));
        return ret;
      }
      if (!withinFarbleSize(width, height)) {
        DEBUG && console.log("[wh-farble] " + label + " readPixels skip size " + width + "x" + height);
        return ret;
      }
      var seed = farbleSeed();
      var flipped = applyFarble(pixels, seed);
      DEBUG && console.log("[wh-farble] " + label + " readPixels " + width + "x" + height + " seed=" + (seed >>> 0).toString(16) + " flipped=" + flipped + " pixels (×3 bytes each)");
      return ret;
    };
  }
  wrapReadPixels(WebGLRenderingContext.prototype, "webgl1", "[object WebGLRenderingContext]");
  if (typeof WebGL2RenderingContext !== "undefined") {
    wrapReadPixels(WebGL2RenderingContext.prototype, "webgl2", "[object WebGL2RenderingContext]");
  }

  // 2c. createImageBitmap — third common canvas extraction surface
  // FingerprintJS Pro and a few commercial libs use createImageBitmap(canvas)
  // to snapshot a canvas without touching toDataURL / toBlob / readPixels —
  // a fast path that would otherwise leak real pixel data. We only intervene
  // when the source is a canvas (HTMLCanvasElement or OffscreenCanvas): the
  // source is farbled via farbleAnyCanvas first, then the original is called
  // with the farbled offscreen copy. Other source types (Image, Video, Blob,
  // ImageData, ImageBitmap) pass through unchanged — they're either
  // unrelated to fingerprinting or already covered by other wrappers.
  // Note: this is a global function, not a prototype method — the receiver
  // guard pattern (checking `this`) doesn't apply; we check the first arg.
  var origCreateImageBitmap = window.createImageBitmap;
  if (typeof origCreateImageBitmap === "function") {
    window.createImageBitmap = function (image) {
      if (farbleState() !== "off" && (isCanvas(image) || isOffscreenCanvas(image))) {
        notify("createImageBitmap.canvasSrc", "fingerprint");
        DEBUG && console.log("[wh-farble] createImageBitmap canvas-source " + image.width + "x" + image.height);
        var off = farbleAnyCanvas(image, farbleSeed());
        if (off) {
          var args = Array.prototype.slice.call(arguments);
          args[0] = off;
          return origCreateImageBitmap.apply(this, args);
        }
      }
      return origCreateImageBitmap.apply(this, arguments);
    };
  }

  // 3. AudioContext fingerprinting
  var OrigAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OrigAudioContext) {
    var origCreateOscillator = OrigAudioContext.prototype.createOscillator;
    OrigAudioContext.prototype.createOscillator = function () {
      notify("AudioContext.createOscillator", "fingerprint");
      return origCreateOscillator.apply(this, arguments);
    };
  }

  // 3b. Audio farbling (M5) — AudioBuffer + AnalyserNode
  //
  // AudioContext fingerprinting (Cloudflare bot detection, FingerprintJS,
  // creepjs) renders a known signal (oscillator → dynamicsCompressor →
  // OfflineAudioContext) and hashes the resulting samples. Perturbing
  // ~100 samples per readback breaks the hash without audible artifact.
  //
  // AudioBuffer.getChannelData returns a *reference* to the underlying
  // Float32Array — mutation persists on the buffer. Two reads of the same
  // channel must return the same data (native behavior + matches
  // fingerprinter expectation), so we dedup via WeakMap<AudioBuffer,
  // Set<channelIndex>>: perturb once on first read, return same data on
  // subsequent reads. Without this, additive ±0.0001 noise would
  // accumulate across calls and a fingerprinter could detect us by
  // comparing two reads.
  //
  // AnalyserNode.{getFloat,getByte}*Data fills a caller-owned buffer each
  // call — no dedup needed; perturb after the native fill completes.
  if (typeof AudioBuffer !== "undefined" && AudioBuffer.prototype && AudioBuffer.prototype.getChannelData) {
    var origGetChannelData = AudioBuffer.prototype.getChannelData;
    var perturbedChannels = new WeakMap();
    AudioBuffer.prototype.getChannelData = function (channel) {
      if (!isAudioBuffer(this)) return origGetChannelData.apply(this, arguments);
      var data = origGetChannelData.apply(this, arguments);
      if (farbleState() === "off" || !data || !data.length) return data;
      var done = perturbedChannels.get(this);
      if (!done) { done = new Set(); perturbedChannels.set(this, done); }
      if (done.has(channel)) return data;
      var seed = farbleSeed();
      var flipped = applyFarbleFloat32(data, seed);
      done.add(channel);
      notify("AudioBuffer.getChannelData", "fingerprint");
      DEBUG && console.log("[wh-farble] AudioBuffer.getChannelData ch=" + channel + " len=" + data.length + " seed=" + seed.toString(16) + " flipped=" + flipped);
      return data;
    };
  }

  function wrapAnalyserMethod(name, perturbFn) {
    if (typeof AnalyserNode === "undefined" || !AnalyserNode.prototype || !AnalyserNode.prototype[name]) return;
    var orig = AnalyserNode.prototype[name];
    AnalyserNode.prototype[name] = function (arr) {
      if (!isAnalyserNode(this)) return orig.apply(this, arguments);
      var ret = orig.apply(this, arguments);
      if (farbleState() === "off" || !arr || !arr.length) return ret;
      var seed = farbleSeed();
      var flipped = perturbFn(arr, seed);
      notify("AnalyserNode." + name, "fingerprint");
      DEBUG && console.log("[wh-farble] AnalyserNode." + name + " len=" + arr.length + " seed=" + seed.toString(16) + " flipped=" + flipped);
      return ret;
    };
  }
  wrapAnalyserMethod("getFloatFrequencyData", applyFarbleFloat32);
  wrapAnalyserMethod("getFloatTimeDomainData", applyFarbleFloat32);
  wrapAnalyserMethod("getByteFrequencyData", applyFarbleUint8);
  wrapAnalyserMethod("getByteTimeDomainData", applyFarbleUint8);

  // 4b. Font enumeration cap (M6) — CanvasRenderingContext2D.measureText
  //
  // Fingerprinters detect installed fonts by setting `ctx.font` to a
  // candidate family then measuring "ABC…" — if width differs from the
  // fallback's, the candidate is installed. Iterating hundreds of font
  // names yields a stable signature ("user has Helvetica, no Lucida
  // Bright" etc.). Defense: classify any font string into one of 11
  // buckets (10 canonical Win32 fonts + "fallback") and return widths
  // from a fixed per-bucket lookup table. Result: every farbled user
  // reports the same Win32 font set regardless of OS or real fonts
  // installed, indistinguishable as a population. Pairs with the
  // future platform="Win32" Tier A lie.
  //
  // We return a duck-typed TextMetrics-like plain object — strict
  // callers checking `instanceof TextMetrics` would notice, but real
  // fingerprinters and most layout code only read `.width`. Native
  // TextMetrics fields are readonly, so an instance shim isn't an
  // option without a Proxy.
  //
  // Acknowledged ceiling (per PRD): SVG-glyph fingerprinting bypasses
  // this entirely. Defense is partial by design; offsetWidth is left
  // un-wrapped (too many legit callers — layout breakage risk).
  //
  // Scope: CanvasRenderingContext2D.prototype only. OffscreenCanvas's
  // 2D context is the acknowledged v1 gap — matches the existing
  // toDataURL/getImageData wrapper scope.

  var FONT_BUCKETS = [
    { name: "Arial", charW: 5.5 },
    { name: "Times", charW: 5.2 },
    { name: "Courier", charW: 6.0 },
    { name: "Verdana", charW: 6.1 },
    { name: "Georgia", charW: 5.4 },
    { name: "Tahoma", charW: 5.3 },
    { name: "Trebuchet", charW: 5.4 },
    { name: "Comic Sans", charW: 5.6 },
    { name: "Impact", charW: 4.8 },
    { name: "Lucida Console", charW: 5.7 },
    { name: "fallback", charW: 5.5 }
  ];
  // Order matters: specific font names first (catch "Verdana, sans-serif"
  // as Verdana, not as the generic sans-serif). Multi-word names before
  // single-word substrings ("Times New Roman" before bare "Times" — only
  // matters for tie-breaking; both map to bucket 1 here).
  var SPECIFIC_FONTS = [
    ["arial", 0], ["helvetica", 0],
    ["times new roman", 1], ["times", 1],
    ["courier new", 2], ["courier", 2],
    ["verdana", 3],
    ["georgia", 4],
    ["tahoma", 5],
    ["trebuchet ms", 6], ["trebuchet", 6],
    ["comic sans ms", 7], ["comic sans", 7],
    ["impact", 8],
    ["lucida console", 9]
  ];
  var GENERIC_FAMILIES = [
    ["sans-serif", 0],
    ["serif", 1],
    ["monospace", 2]
  ];
  function classifyFont(fontStr) {
    if (!fontStr) return 10;
    var lc = String(fontStr).toLowerCase();
    for (var i = 0; i < SPECIFIC_FONTS.length; i++) {
      if (lc.indexOf(SPECIFIC_FONTS[i][0]) >= 0) return SPECIFIC_FONTS[i][1];
    }
    for (var j = 0; j < GENERIC_FAMILIES.length; j++) {
      if (lc.indexOf(GENERIC_FAMILIES[j][0]) >= 0) return GENERIC_FAMILIES[j][1];
    }
    return 10;
  }
  // CSS font shorthand size token; rough px conversion for pt/em/rem
  // (em/rem here treats 1em ≈ 16px since we don't know the element's
  // parent computed font-size — fingerprinters who care about exact em
  // resolution would need to bypass us via SVG anyway).
  function parseFontSize(fontStr) {
    var m = /(\d+(?:\.\d+)?)\s*(px|pt|em|rem)/i.exec(fontStr || "");
    if (!m) return 10;
    var n = parseFloat(m[1]);
    var unit = m[2].toLowerCase();
    if (unit === "pt") n *= 1.333;
    else if (unit === "em" || unit === "rem") n *= 16;
    return n > 0 ? n : 10;
  }
  function fakeTextMetrics(width) {
    return {
      width: width,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: width,
      actualBoundingBoxAscent: 0,
      actualBoundingBoxDescent: 0,
      fontBoundingBoxAscent: 0,
      fontBoundingBoxDescent: 0,
      emHeightAscent: 0,
      emHeightDescent: 0,
      alphabeticBaseline: 0,
      hangingBaseline: 0,
      ideographicBaseline: 0
    };
  }

  if (typeof CanvasRenderingContext2D !== "undefined" && CanvasRenderingContext2D.prototype && CanvasRenderingContext2D.prototype.measureText) {
    var origMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function (text) {
      if (!isCanvas2DCtx(this)) return origMeasureText.apply(this, arguments);
      if (farbleState() === "off") return origMeasureText.apply(this, arguments);
      var fontStr = "";
      try { fontStr = this.font || ""; } catch (e) {}
      var bucket = classifyFont(fontStr);
      var size = parseFontSize(fontStr);
      var len = (text == null) ? 0 : String(text).length;
      var width = len * FONT_BUCKETS[bucket].charW * (size / 10);
      notify("CanvasRenderingContext2D.measureText", "fingerprint");
      DEBUG && console.log("[wh-farble] measureText font='" + fontStr + "' bucket=" + FONT_BUCKETS[bucket].name + " size=" + size + " text.len=" + len + " width=" + width.toFixed(2));
      return fakeTextMetrics(width);
    };
  }

  // Phase 2 Slice 2 step 1: per-origin farble contract. detect-watched.js
  // (ISOLATED world) writes two attributes on <html>:
  //   data-wh-farble-state = "off" | "stable" | "per-tab"
  //   data-wh-farble-seed  = 8-char hex int
  // Read at call-time, not install-time, so the async storage round-trip
  // has until the page's first probe to land. Unknown / missing state
  // defaults to "off" (fail-safe — never farble if contract is malformed).
  function farbleState() {
    try {
      var el = document.documentElement;
      if (!el) return "off";
      var s = el.getAttribute("data-wh-farble-state");
      return (s === "stable" || s === "per-tab") ? s : "off";
    } catch (e) { return "off"; }
  }
  function farbleSeed() {
    try {
      var el = document.documentElement;
      if (!el) return 0;
      var hex = el.getAttribute("data-wh-farble-seed") || "";
      var n = parseInt(hex, 16);
      return isFinite(n) ? (n >>> 0) : 0;
    } catch (e) { return 0; }
  }

  // 4. navigator.hardwareConcurrency
  var origConcurrency = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency");
  if (origConcurrency && origConcurrency.get) {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
      get: function () {
        notify("Navigator.hardwareConcurrency", "fingerprint");
        if (farbleState() !== "off") return 4;
        return origConcurrency.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }

  // 5. navigator.languages
  var origLanguages = Object.getOwnPropertyDescriptor(Navigator.prototype, "languages");
  if (origLanguages && origLanguages.get) {
    var FARBLED_LANGUAGES = Object.freeze(["en-US", "en"]);
    Object.defineProperty(Navigator.prototype, "languages", {
      get: function () {
        notify("Navigator.languages", "fingerprint");
        if (farbleState() !== "off") return FARBLED_LANGUAGES;
        return origLanguages.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }

  // 5b. Slice 1 Tier A constants — platform / deviceMemory / screen.* / perf.now
  //
  // Property-getter lies. Per the receiver-guard pattern lock in the PRD,
  // property descriptors don't need brand checks — the "wrong receiver"
  // probe (`getter.call({})`) doesn't apply to descriptors the way it
  // does to prototype methods. Each lie is gated on farbleState() so
  // the OFF path stays bit-identical to native.
  //
  // Locked values (PRD § "Resolved during Slice 2 design"):
  //   navigator.languages → ["en-US", "en"]       (above, section 5)
  //   navigator.platform  → "Win32"               (max-population blend)
  //   navigator.deviceMemory → 8                  (modal)
  //   screen.width/height → snap to nearest of
  //     {1366×768, 1920×1080, 2560×1440, 3840×2160}
  //     "nearest" not "round-up": 1440×900 → 1366×768;
  //     3000×2000 → 2560×1440. Avoids both quality hits and breakage.
  //   screen.colorDepth / pixelDepth → 24
  //   performance.now() → floor to 100µs (0.1ms) — Spectre-style
  //     timing-attack precision floor. Native is ~5µs since Chrome's
  //     post-Spectre mitigation; we coarsen further.

  var origPlatform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
  if (origPlatform && origPlatform.get) {
    Object.defineProperty(Navigator.prototype, "platform", {
      get: function () {
        notify("Navigator.platform", "fingerprint");
        if (farbleState() !== "off") return "Win32";
        return origPlatform.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }

  var origDeviceMemory = Object.getOwnPropertyDescriptor(Navigator.prototype, "deviceMemory");
  if (origDeviceMemory && origDeviceMemory.get) {
    Object.defineProperty(Navigator.prototype, "deviceMemory", {
      get: function () {
        notify("Navigator.deviceMemory", "fingerprint");
        if (farbleState() !== "off") return 8;
        return origDeviceMemory.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }

  // Screen.* — snap real (w,h) to nearest bucket by Euclidean distance.
  // Cached at install time (screen size doesn't change mid-page-load
  // for the relevant FP probes). If real getters are missing on some
  // exotic UA, fall back to the 1920×1080 bucket center.
  var SCREEN_BUCKETS = [[1366, 768], [1920, 1080], [2560, 1440], [3840, 2160]];
  var origScreenWidth = Object.getOwnPropertyDescriptor(Screen.prototype, "width");
  var origScreenHeight = Object.getOwnPropertyDescriptor(Screen.prototype, "height");
  var origScreenColorDepth = Object.getOwnPropertyDescriptor(Screen.prototype, "colorDepth");
  var origScreenPixelDepth = Object.getOwnPropertyDescriptor(Screen.prototype, "pixelDepth");
  var snappedScreen = [1920, 1080];
  try {
    if (origScreenWidth && origScreenWidth.get && origScreenHeight && origScreenHeight.get) {
      var realW = origScreenWidth.get.call(screen) | 0;
      var realH = origScreenHeight.get.call(screen) | 0;
      var bestDist = Infinity;
      for (var i = 0; i < SCREEN_BUCKETS.length; i++) {
        var dw = SCREEN_BUCKETS[i][0] - realW;
        var dh = SCREEN_BUCKETS[i][1] - realH;
        var d = dw * dw + dh * dh;
        if (d < bestDist) { bestDist = d; snappedScreen = SCREEN_BUCKETS[i]; }
      }
    }
  } catch (e) {}

  if (origScreenWidth && origScreenWidth.get) {
    Object.defineProperty(Screen.prototype, "width", {
      get: function () {
        notify("Screen.width", "fingerprint");
        if (farbleState() !== "off") return snappedScreen[0];
        return origScreenWidth.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }
  if (origScreenHeight && origScreenHeight.get) {
    Object.defineProperty(Screen.prototype, "height", {
      get: function () {
        notify("Screen.height", "fingerprint");
        if (farbleState() !== "off") return snappedScreen[1];
        return origScreenHeight.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }
  if (origScreenColorDepth && origScreenColorDepth.get) {
    Object.defineProperty(Screen.prototype, "colorDepth", {
      get: function () {
        notify("Screen.colorDepth", "fingerprint");
        if (farbleState() !== "off") return 24;
        return origScreenColorDepth.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }
  if (origScreenPixelDepth && origScreenPixelDepth.get) {
    Object.defineProperty(Screen.prototype, "pixelDepth", {
      get: function () {
        notify("Screen.pixelDepth", "fingerprint");
        if (farbleState() !== "off") return 24;
        return origScreenPixelDepth.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }

  // performance.now() precision floor. Native is ~5µs post-Spectre;
  // we floor to 100µs (0.1ms). Wrapped via prototype to catch both
  // performance.now() and Performance.prototype.now.call(...). Brand
  // check would apply here (it's a method not a descriptor), but
  // performance.now is well-behaved across realms and the cost of
  // misuse is just "returns NaN" — not a detection vector.
  if (typeof Performance !== "undefined" && Performance.prototype && Performance.prototype.now) {
    var origPerfNow = Performance.prototype.now;
    Performance.prototype.now = function () {
      var t = origPerfNow.apply(this, arguments);
      if (farbleState() === "off") return t;
      notify("Performance.now", "fingerprint");
      return Math.floor(t * 10) / 10;
    };
  }

  // 6. Clipboard access
  if (navigator.clipboard) {
    var origReadText = navigator.clipboard.readText;
    if (origReadText) {
      navigator.clipboard.readText = function () {
        notify("Clipboard.readText", "permission");
        return origReadText.apply(navigator.clipboard, arguments);
      };
    }

    var origRead = navigator.clipboard.read;
    if (origRead) {
      navigator.clipboard.read = function () {
        notify("Clipboard.read", "permission");
        return origRead.apply(navigator.clipboard, arguments);
      };
    }
  }

  // 7. Geolocation
  if (navigator.geolocation) {
    var origGetPosition = navigator.geolocation.getCurrentPosition;
    navigator.geolocation.getCurrentPosition = function () {
      notify("Geolocation.getCurrentPosition", "permission");
      return origGetPosition.apply(navigator.geolocation, arguments);
    };

    var origWatchPosition = navigator.geolocation.watchPosition;
    navigator.geolocation.watchPosition = function () {
      notify("Geolocation.watchPosition", "permission");
      return origWatchPosition.apply(navigator.geolocation, arguments);
    };
  }

  // 8. Notification permission
  if (typeof Notification !== "undefined" && Notification.requestPermission) {
    var origRequestPermission = Notification.requestPermission;
    Notification.requestPermission = function () {
      notify("Notification.requestPermission", "permission");
      return origRequestPermission.apply(Notification, arguments);
    };
  }

  // --- wearecooked: sendBeacon wrapper ---
  var origBeacon = navigator.sendBeacon;
  if (origBeacon) {
    navigator.sendBeacon = function (url, data) {
      try {
        window.postMessage({
          type: "__wearecounted_beacon__",
          url: String(url),
        }, "*");
      } catch (e) {}
      return origBeacon.apply(navigator, arguments);
    };
  }
})();
