import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Hardened TLS-impersonating HTTP client for ZCode start-plan.
// Emulates Chrome 131 BoringSSL / Post-Quantum TLS 1.3 ClientHello via wreq-js,
// matching the Ciii-ATM/zcode-gateway and desktop Electron signature with proxy awareness.

const sessionCache = new Map();
let cachedWreq = null;

function getNativeRequire() {
  if (typeof globalThis !== "undefined") {
    if (typeof globalThis.__xrouter_native_require__ === "function") return globalThis.__xrouter_native_require__;
    if (typeof globalThis.__non_webpack_require__ === "function") return globalThis.__non_webpack_require__;
  }
  if (typeof __non_webpack_require__ === "function") return __non_webpack_require__;
  try {
    if (typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
      const nodeModule = process.getBuiltinModule("module");
      if (typeof nodeModule?.createRequire === "function") {
        return nodeModule.createRequire(process.cwd() + "/package.json");
      }
    }
  } catch {}
  try {
    const dynamicRequire = new Function("fromPath", "const m = typeof process !== 'undefined' && process.getBuiltinModule ? process.getBuiltinModule('module') : (typeof require !== 'undefined' ? require('module') : null); return m ? m.createRequire(fromPath) : null;");
    const req = dynamicRequire(process.cwd() + "/package.json");
    if (req) return req;
  } catch {}
  return null;
}

function isValidWreq(mod) {
  return mod && (typeof mod.createSession === "function" || typeof mod.default?.createSession === "function");
}

function normalizeWreq(mod) {
  if (!mod) return null;
  return typeof mod.createSession === "function" ? mod : mod.default;
}

async function getWreqModule() {
  if (cachedWreq) return cachedWreq;

  // 0. Global preloaded instance from custom-server.js / standalone server.js
  if (typeof globalThis !== "undefined" && isValidWreq(globalThis.__xrouter_wreq__)) {
    cachedWreq = normalizeWreq(globalThis.__xrouter_wreq__);
    return cachedWreq;
  }

  const nativeReq = getNativeRequire();

  // 1. Direct native CommonJS require (bypasses webpack chunk scope)
  if (nativeReq) {
    try {
      const mod = nativeReq("wreq-js");
      if (isValidWreq(mod)) {
        cachedWreq = normalizeWreq(mod);
        return cachedWreq;
      }
    } catch {}
  }

  // 2. createRequire via native module
  let createReq = null;
  if (nativeReq && typeof nativeReq.resolve === "function") {
    try {
      const nodeModule = nativeReq("node:module") || nativeReq("module");
      createReq = nodeModule?.createRequire || nodeModule?.default?.createRequire;
    } catch {}
  }
  if (!createReq && typeof process !== "undefined" && typeof process.getBuiltinModule === "function") {
    try {
      createReq = process.getBuiltinModule("module")?.createRequire;
    } catch {}
  }
  if (!createReq) {
    try {
      const dynamicModule = new Function("return (typeof process !== 'undefined' && process.getBuiltinModule ? process.getBuiltinModule('module') : (typeof require !== 'undefined' ? require('module') : null));");
      createReq = dynamicModule()?.createRequire;
    } catch {}
  }

  const cwd = process.cwd();
  const pkgCandidates = [
    path.resolve(cwd, "package.json"),
    path.resolve(cwd, ".next", "standalone", "package.json"),
    path.resolve(cwd, "..", "package.json"),
    path.resolve(cwd, "..", "..", "package.json"),
    "/root/xrouter/.next/standalone/package.json",
    "/root/xrouter/package.json",
  ];

  if (typeof createReq === "function") {
    for (const pkg of pkgCandidates) {
      if (fs.existsSync(pkg)) {
        try {
          const req = createReq(pkg);
          const mod = req("wreq-js");
          if (isValidWreq(mod)) {
            cachedWreq = normalizeWreq(mod);
            return cachedWreq;
          }
        } catch {}
      }
    }

    const directCandidates = [
      path.resolve(cwd, "node_modules", "wreq-js", "dist", "wreq-js.cjs"),
      path.resolve(cwd, ".next", "standalone", "node_modules", "wreq-js", "dist", "wreq-js.cjs"),
      path.resolve(cwd, "..", "..", "node_modules", "wreq-js", "dist", "wreq-js.cjs"),
      "/root/xrouter/.next/standalone/node_modules/wreq-js/dist/wreq-js.cjs",
      "/root/xrouter/node_modules/wreq-js/dist/wreq-js.cjs",
    ];

    for (const direct of directCandidates) {
      if (fs.existsSync(direct)) {
        for (const pkg of pkgCandidates) {
          if (fs.existsSync(pkg)) {
            try {
              const req = createReq(pkg);
              const mod = req(direct);
              if (isValidWreq(mod)) {
                cachedWreq = normalizeWreq(mod);
                return cachedWreq;
              }
            } catch {}
          }
        }
      }
    }
  }

  // 3. True native ESM dynamic import via Function constructor (completely hidden from webpack AST)
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)");
    const mod = await dynamicImport("wreq-js");
    if (isValidWreq(mod)) {
      cachedWreq = normalizeWreq(mod);
      return cachedWreq;
    }
  } catch {}

  // 4. Direct file URL import via dynamic import
  try {
    const directCandidates = [
      path.resolve(cwd, "node_modules", "wreq-js", "dist", "wreq-js.cjs"),
      path.resolve(cwd, ".next", "standalone", "node_modules", "wreq-js", "dist", "wreq-js.cjs"),
      "/root/xrouter/.next/standalone/node_modules/wreq-js/dist/wreq-js.cjs",
      "/root/xrouter/node_modules/wreq-js/dist/wreq-js.cjs",
    ];
    const dynamicImport = new Function("specifier", "return import(specifier)");
    for (const file of directCandidates) {
      if (fs.existsSync(file)) {
        try {
          const mod = await dynamicImport(pathToFileURL(file).href);
          if (isValidWreq(mod)) {
            cachedWreq = normalizeWreq(mod);
            return cachedWreq;
          }
        } catch {}
      }
    }
  } catch {}

  // 5. Fallback webpack import as last resort
  try {
    const mod = await import(/* webpackIgnore: true */ "wreq-js");
    if (isValidWreq(mod)) {
      cachedWreq = normalizeWreq(mod);
      return cachedWreq;
    }
  } catch (esmError) {
    throw new Error(`wreq-js import failed: ${esmError?.message || esmError}`);
  }

  throw new Error("wreq-js runtime missing createSession");
}

async function getSession(proxyUrl = "") {
  const cacheKey = proxyUrl || "direct";
  if (sessionCache.has(cacheKey)) {
    return sessionCache.get(cacheKey);
  }

  const promise = (async () => {
    const wreq = await getWreqModule();
    if (!wreq || typeof wreq.createSession !== "function") {
      throw new Error("wreq-js runtime missing createSession");
    }

    const sessionOpts = {
      profile: "chrome_133",
      emulation: {
        tlsOptions: {
          cipherList: [
            "TLS_AES_128_GCM_SHA256",
            "TLS_AES_256_GCM_SHA384",
            "TLS_CHACHA20_POLY1305_SHA256",
            "ECDHE-ECDSA-AES128-GCM-SHA256",
            "ECDHE-RSA-AES128-GCM-SHA256",
            "ECDHE-ECDSA-AES256-GCM-SHA384",
            "ECDHE-RSA-AES256-GCM-SHA384",
            "ECDHE-ECDSA-CHACHA20-POLY1305",
            "ECDHE-RSA-CHACHA20-POLY1305",
            "ECDHE-ECDSA-AES128-SHA",
            "ECDHE-RSA-AES128-SHA",
            "ECDHE-ECDSA-AES256-SHA",
            "ECDHE-RSA-AES256-SHA",
            "AES128-GCM-SHA256",
            "AES256-GCM-SHA384",
            "AES128-SHA",
            "AES256-SHA",
          ].join(":"),
        },
      },
    };

    if (proxyUrl) {
      sessionOpts.proxy = proxyUrl;
    }

    return await wreq.createSession(sessionOpts);
  })().catch((err) => {
    sessionCache.delete(cacheKey);
    throw err;
  });

  sessionCache.set(cacheKey, promise);
  return promise;
}

export function resetZcodeTlsSession() {
  for (const [, promise] of sessionCache) {
    promise.then((s) => s.close?.()).catch(() => {});
  }
  sessionCache.clear();
}

export async function zcodeTlsFetch(url, init = {}, { signal, timeoutMs = 300000, proxy } = {}) {
  const proxyUrl = proxy || init.proxy || "";
  let session;

  try {
    session = await getSession(proxyUrl);
  } catch (error) {
    console.warn(`[ZcodeTLS] wreq-js unavailable (${error?.message || error}), failing open to native fetch`);
    return fetch(url, {
      method: init.method || "GET",
      headers: init.headers,
      body: init.body,
      signal,
    });
  }

  const options = {
    method: init.method || "GET",
    headers: init.headers,
    redirect: "follow",
    timeout: timeoutMs,
  };
  if (init.body !== undefined) options.body = init.body;
  if (signal) options.signal = signal;

  try {
    const res = await session.fetch(url, options);
    const headers = {};
    res.headers?.forEach?.((value, key) => {
      headers[key] = value;
    });
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  } catch (fetchErr) {
    sessionCache.delete(proxyUrl || "direct");
    console.warn(`[ZcodeTLS] Session fetch failed (${fetchErr.message})`);

    if (proxyUrl) {
      throw fetchErr;
    }

    return fetch(url, {
      method: init.method || "GET",
      headers: init.headers,
      body: init.body,
      signal,
    });
  }
}
