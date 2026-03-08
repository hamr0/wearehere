/**
 * init-scripts.js — Scripts injected BEFORE page navigation via
 * Page.addScriptToEvaluateOnNewDocument. These wrap browser APIs
 * to detect fingerprinting and beacon/sendBeacon calls in real-time.
 *
 * Runs in the PAGE context (not Node.js). Must be a self-contained string.
 */

/**
 * Returns the init script source code as a string.
 * This script creates window.__wearehere to collect all detections.
 */
export function getInitScript() {
  return `
(function() {
  'use strict';

  // Collection object — page scripts populate, we read later via Runtime.evaluate
  window.__wearehere = {
    fingerprinting: [],
    beacons: [],
  };

  // --- Fingerprinting detection: wrap prototype methods ---

  function wrapMethod(obj, prop, category) {
    if (!obj || !obj[prop]) return;
    const original = obj[prop];
    obj[prop] = function(...args) {
      try {
        const stack = new Error().stack || '';
        const frames = stack.split('\\n').slice(1, 4).map(f => f.trim());
        window.__wearehere.fingerprinting.push({
          api: category + '.' + prop,
          category: category,
          timestamp: Date.now(),
          stack: frames,
        });
      } catch {}
      return original.apply(this, args);
    };
  }

  function wrapGetter(obj, prop, category) {
    if (!obj) return;
    const descriptor = Object.getOwnPropertyDescriptor(obj, prop);
    if (!descriptor || !descriptor.get) return;
    const originalGet = descriptor.get;
    Object.defineProperty(obj, prop, {
      get: function() {
        try {
          const stack = new Error().stack || '';
          const frames = stack.split('\\n').slice(1, 4).map(f => f.trim());
          window.__wearehere.fingerprinting.push({
            api: category + '.' + prop,
            category: category,
            timestamp: Date.now(),
            stack: frames,
          });
        } catch {}
        return originalGet.call(this);
      },
      configurable: true,
    });
  }

  // Canvas fingerprinting
  if (typeof HTMLCanvasElement !== 'undefined') {
    wrapMethod(HTMLCanvasElement.prototype, 'toDataURL', 'Canvas');
    wrapMethod(HTMLCanvasElement.prototype, 'toBlob', 'Canvas');
  }
  if (typeof CanvasRenderingContext2D !== 'undefined') {
    wrapMethod(CanvasRenderingContext2D.prototype, 'getImageData', 'Canvas');
  }

  // WebGL fingerprinting
  if (typeof WebGLRenderingContext !== 'undefined') {
    wrapMethod(WebGLRenderingContext.prototype, 'getParameter', 'WebGL');
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    wrapMethod(WebGL2RenderingContext.prototype, 'getParameter', 'WebGL');
  }

  // AudioContext fingerprinting
  if (typeof AudioContext !== 'undefined') {
    wrapMethod(AudioContext.prototype, 'createOscillator', 'AudioContext');
  }
  if (typeof OfflineAudioContext !== 'undefined') {
    wrapMethod(OfflineAudioContext.prototype, 'startRendering', 'AudioContext');
  }

  // Navigator property fingerprinting
  wrapGetter(Navigator.prototype, 'hardwareConcurrency', 'Navigator');
  wrapGetter(Navigator.prototype, 'languages', 'Navigator');
  wrapGetter(Navigator.prototype, 'platform', 'Navigator');
  wrapGetter(Navigator.prototype, 'deviceMemory', 'Navigator');

  // Screen fingerprinting
  if (typeof Screen !== 'undefined') {
    wrapGetter(Screen.prototype, 'colorDepth', 'Screen');
    wrapGetter(Screen.prototype, 'pixelDepth', 'Screen');
  }

  // --- Beacon / sendBeacon interception ---

  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(url, data) {
      try {
        window.__wearehere.beacons.push({
          url: url,
          dataSize: data ? (typeof data === 'string' ? data.length : 0) : 0,
          timestamp: Date.now(),
        });
      } catch {}
      return originalSendBeacon(url, data);
    };
  }

})();
`;
}
