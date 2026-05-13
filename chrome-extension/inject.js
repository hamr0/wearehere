"use strict";

(function () {
  // --- wearewatched: fingerprinting + permission wrappers ---
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

  // 1. Canvas fingerprinting
  var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function () {
    notify("Canvas.toDataURL", "fingerprint");
    return origToDataURL.apply(this, arguments);
  };

  // 2. WebGL fingerprinting
  var origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (pname) {
    notify("WebGL.getParameter", "fingerprint");
    return origGetParameter.apply(this, arguments);
  };

  // 3. AudioContext fingerprinting
  var OrigAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OrigAudioContext) {
    var origCreateOscillator = OrigAudioContext.prototype.createOscillator;
    OrigAudioContext.prototype.createOscillator = function () {
      notify("AudioContext.createOscillator", "fingerprint");
      return origCreateOscillator.apply(this, arguments);
    };
  }

  // 4. navigator.hardwareConcurrency
  var origConcurrency = Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency");
  if (origConcurrency && origConcurrency.get) {
    Object.defineProperty(Navigator.prototype, "hardwareConcurrency", {
      get: function () {
        notify("Navigator.hardwareConcurrency", "fingerprint");
        return origConcurrency.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
  }

  // 5. navigator.languages
  var origLanguages = Object.getOwnPropertyDescriptor(Navigator.prototype, "languages");
  if (origLanguages && origLanguages.get) {
    Object.defineProperty(Navigator.prototype, "languages", {
      get: function () {
        notify("Navigator.languages", "fingerprint");
        return origLanguages.get.call(this);
      },
      configurable: true,
      enumerable: true
    });
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
