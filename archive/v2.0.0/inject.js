/**
 * inject.js — Runs in PAGE context (not content script).
 * Wraps browser APIs to detect fingerprinting and beacon calls.
 * Relays detections to content script via postMessage.
 */
(function() {
  'use strict';

  const FP = [];
  const BEACONS = [];

  function wrapMethod(obj, prop, category) {
    if (!obj || typeof obj[prop] !== 'function') return;
    const original = obj[prop];
    obj[prop] = function(...args) {
      try {
        const stack = new Error().stack || '';
        const frames = stack.split('\n').slice(1, 4).map(f => f.trim());
        FP.push({ api: category + '.' + prop, category, stack: frames, t: Date.now() });
      } catch {}
      return original.apply(this, args);
    };
  }

  function wrapGetter(obj, prop, category) {
    if (!obj) return;
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (!desc || !desc.get) return;
    const origGet = desc.get;
    Object.defineProperty(obj, prop, {
      get() {
        try {
          const stack = new Error().stack || '';
          const frames = stack.split('\n').slice(1, 4).map(f => f.trim());
          FP.push({ api: category + '.' + prop, category, stack: frames, t: Date.now() });
        } catch {}
        return origGet.call(this);
      },
      configurable: true,
    });
  }

  // Canvas
  if (typeof HTMLCanvasElement !== 'undefined') {
    wrapMethod(HTMLCanvasElement.prototype, 'toDataURL', 'Canvas');
    wrapMethod(HTMLCanvasElement.prototype, 'toBlob', 'Canvas');
  }
  if (typeof CanvasRenderingContext2D !== 'undefined') {
    wrapMethod(CanvasRenderingContext2D.prototype, 'getImageData', 'Canvas');
  }

  // WebGL
  if (typeof WebGLRenderingContext !== 'undefined') {
    wrapMethod(WebGLRenderingContext.prototype, 'getParameter', 'WebGL');
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    wrapMethod(WebGL2RenderingContext.prototype, 'getParameter', 'WebGL');
  }

  // AudioContext
  if (typeof AudioContext !== 'undefined') {
    wrapMethod(AudioContext.prototype, 'createOscillator', 'AudioContext');
  }
  if (typeof OfflineAudioContext !== 'undefined') {
    wrapMethod(OfflineAudioContext.prototype, 'startRendering', 'AudioContext');
  }

  // Navigator
  wrapGetter(Navigator.prototype, 'hardwareConcurrency', 'Navigator');
  wrapGetter(Navigator.prototype, 'languages', 'Navigator');
  wrapGetter(Navigator.prototype, 'platform', 'Navigator');
  wrapGetter(Navigator.prototype, 'deviceMemory', 'Navigator');

  // Screen
  if (typeof Screen !== 'undefined') {
    wrapGetter(Screen.prototype, 'colorDepth', 'Screen');
    wrapGetter(Screen.prototype, 'pixelDepth', 'Screen');
  }

  // Beacon
  if (navigator.sendBeacon) {
    const origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      try {
        BEACONS.push({ url, size: data ? (typeof data === 'string' ? data.length : 0) : 0, t: Date.now() });
      } catch {}
      return origBeacon(url, data);
    };
  }

  // Relay to content script every 2s and on page unload
  function flush() {
    if (FP.length || BEACONS.length) {
      window.postMessage({
        __wearehere: true,
        fingerprinting: FP.splice(0),
        beacons: BEACONS.splice(0),
      }, '*');
    }
  }

  setInterval(flush, 2000);
  window.addEventListener('beforeunload', flush);
  // Also flush after initial page scripts run
  setTimeout(flush, 3000);
})();
