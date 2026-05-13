// _helpers.js — load chrome-extension service-worker modules in a Node
// VM with stubbed chrome.* APIs so their pure logic can be unit-tested.
//
// These modules are written for the MV3 service-worker context and use
// `self.X = Y` exports, `chrome.storage.local`, and `console.log`. We
// give them a VM context that satisfies all three, then return the
// context so tests can call `ctx.X(...)` on the exposed functions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SRC_DIR = resolve(__dirname, '..', 'chrome-extension');

// JSON-roundtrip a value so deepStrictEqual works across the vm realm
// boundary. Without this, the prototypes differ and strict-equality
// assertions fail even on structurally-identical plain-data objects.
export function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

// In-memory chrome.storage.local stub. Backs `get` (read) + `set` (write)
// + `remove` (delete). Mirrors the promise API used by the source files.
export function makeChromeStub(initial = {}) {
  const local = { ...initial };
  return {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return { ...local };
          if (typeof keys === 'string') return { [keys]: local[keys] };
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) out[k] = local[k];
            return out;
          }
          const out = {};
          for (const k of Object.keys(keys)) out[k] = local[k] !== undefined ? local[k] : keys[k];
          return out;
        },
        async set(obj) { Object.assign(local, obj); },
        async remove(key) { delete local[key]; },
      },
      session: {
        async get() { return {}; },
        async set() {},
        async remove() {},
      },
    },
    alarms: {
      get: (_n, cb) => cb && cb(null),
      create: () => {},
      onAlarm: { addListener: () => {} },
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: () => {},
      getURL: (p) => `chrome-extension://stub/${p}`,
      lastError: null,
    },
    tabs: {
      query: (_q, cb) => cb && cb([]),
      get: (_id, cb) => cb && cb(null),
      onRemoved: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      onActivated: { addListener: () => {} },
      onCreated: { addListener: () => {} },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
    webRequest: {
      onBeforeRequest: { addListener: () => {} },
      onBeforeSendHeaders: { addListener: () => {} },
      onHeadersReceived: { addListener: () => {} },
      onCompleted: { addListener: () => {} },
      onErrorOccurred: { addListener: () => {} },
    },
    cookies: {
      getAll: async () => [],
      set: async () => ({}),
      remove: async () => ({}),
    },
  };
}

// Load a chrome-extension/*.js file inside a VM context, exposing
// stubbed globals. Returns the context so tests can read `ctx.<fn>`.
export function loadServiceWorkerModule(filename, { chromeStub = makeChromeStub(), extras = {} } = {}) {
  const src = readFileSync(resolve(SRC_DIR, filename), 'utf8');
  const ctx = {
    chrome: chromeStub,
    console: { log: () => {}, warn: () => {}, error: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URL, URLSearchParams,
    Date, Math, JSON, Array, Object, Number, String, Boolean,
    Set, Map, WeakSet, WeakMap, Promise, Symbol, RegExp, Error,
    ...extras,
  };
  // `self` aliases the context, so `self.X = Y` and `self.Y` see the
  // same global namespace the source files expect.
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename });
  return ctx;
}
