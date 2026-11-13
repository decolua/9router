// browserPool.js — Shared stealth browser pool for web-cookie providers.
//
// Some web flows (ChatGPT web's Cloudflare, Claude web's Turnstile, Meta AI's
// JS-challenged token page) validate values that only a real browser can
// produce (DOM layout measurements like offsetWidth/Height, getBoundingClientRect,
// getComputedStyle, iframe contentWindow probes). Plain Node fetch + a
// VM-stubs solver structurally runs the JS but cannot match those values,
// so the server rejects the request.
//
// This pool keeps one Chromium instance warm and serves "browser contexts"
// (one per caller-defined isolation key) on demand. Each context owns one or
// more pages; the caller is expected to be polite (one page per request,
// close on done).
//
// Engine priority (headless): Obscura (Rust CDP browser, ./obscura.js) →
// cloakbrowser (npm, binary-level fingerprint patches) → plain playwright
// Chromium. The plain fallback works for cookie-only flows but strong
// anti-bot challenges detect that Chromium build.
//
// Opt-in: pool only launches Chromium when an executor explicitly asks for a
// context, so users who never use the browser-backed path pay zero startup
// cost. Set NINEROUTER_BROWSER_POOL=off to fully disable.

import { Buffer } from "node:buffer";
import { loadRuntimeDep } from "./lazyRuntime.js";

import { connectObscuraBrowser } from "./obscura.js";
import { ensureVirtualDisplay, stopVirtualDisplay } from "./virtualDisplay.js";
import { launchChromiumWithFallback } from "../executors/browserExecutableCheck.js";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export function isPoolEnabled() {
  const flag = process.env.NINEROUTER_BROWSER_POOL;
  if (flag === undefined) return true;
  return flag !== "off" && flag !== "0" && flag !== "false";
}

// Lightweight, cumulative browser-pool telemetry.
function createBrowserPoolMetrics() {
  return {
    browserLaunches: 0,
    browserLaunchFailures: 0,
    contextsCreated: 0,
    contextsReused: 0,
    contextsEvicted: 0,
    contextsReleased: 0,
    contextCreateFailures: 0,
    shutdowns: 0,
    lastShutdownReason: null,
  };
}

const state = {
  browser: null,
  engine: null, // "obscura" | "cloakbrowser" | "chromium"
  headedBrowser: null,
  contexts: new Map(),
  pendingContexts: new Map(),
  launching: null,
  headedLaunching: null,
  generation: 0,
  lastActivity: 0,
  idleTimer: null,
  evictTimer: null,
  cloakLaunch: null,
  cloakLaunchResolved: false,
  metrics: createBrowserPoolMetrics(),
};

const POOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const CONTEXT_TTL_MS = 10 * 60 * 1000; // 10 min — evict stale contexts
const EVICT_INTERVAL_MS = 60 * 1000; // check every 60s
const DISK_CACHE_BYTES = 50 * 1024 * 1024; // 50 MB per browser process

function getCloakbrowserModuleId() {
  // Keep this computed: cloakbrowser is an optional runtime enhancer, and a literal
  // dynamic import with the package name makes bundlers resolve it during compilation.
  return ["cloak", "browser"].join("");
}

async function resolveCloakLaunch() {
  if (state.cloakLaunchResolved) return state.cloakLaunch;
  state.cloakLaunchResolved = true;
  try {
    const mod = await import(
      /* webpackIgnore: true */
      getCloakbrowserModuleId()
    );
    state.cloakLaunch = mod.launch ?? null;
  } catch {
    state.cloakLaunch = null;
  }
  return state.cloakLaunch;
}

function resetIdleTimer() {
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(() => {
    void shutdownPool("idle-timeout");
  }, POOL_IDLE_TIMEOUT_MS);
  state.idleTimer.unref?.();
}

function evictStaleContexts() {
  const now = Date.now();
  for (const [key, pooled] of state.contexts) {
    if (now - pooled.lastUsed > CONTEXT_TTL_MS) {
      console.log(
        "[BrowserPool] Evicted stale context",
        "(idle",
        ((now - pooled.lastUsed) / 1000).toFixed(0) + "s)"
      );
      state.contexts.delete(key);
      state.metrics.contextsEvicted++;
      pooled.context.close().catch(() => {});
    }
  }
  // Also evict pendingContexts entries that never resolved, so a hung
  // launch cannot pin the map (and the pool) open forever.
  const PENDING_TTL_MS = 5 * 60 * 1000;
  for (const [key, pending] of state.pendingContexts) {
    if (now - pending.createdAt > PENDING_TTL_MS) {
      state.pendingContexts.delete(key);
      state.metrics.contextsEvicted++;
    }
  }
  if (
    state.contexts.size === 0 &&
    state.pendingContexts.size === 0 &&
    !state.launching &&
    !state.headedLaunching
  ) {
    void shutdownPool("all-contexts-evicted");
  }
}

function startEvictTimer() {
  if (state.evictTimer) clearInterval(state.evictTimer);
  state.evictTimer = setInterval(() => evictStaleContexts(), EVICT_INTERVAL_MS);
  state.evictTimer.unref?.();
}

function currentBrowser(headless) {
  const browser = headless ? state.browser : state.headedBrowser;
  if (browser?.isConnected()) return browser;
  if (browser) setCurrentBrowser(headless, null);
  return null;
}

function setCurrentBrowser(headless, browser) {
  if (headless) state.browser = browser;
  else state.headedBrowser = browser;
}

function currentBrowserLaunch(headless) {
  return headless ? state.launching : state.headedLaunching;
}

function setBrowserLaunch(headless, launch) {
  if (headless) state.launching = launch;
  else state.headedLaunching = launch;
}

function clearBrowserLaunch(headless, launch) {
  if (currentBrowserLaunch(headless) === launch) setBrowserLaunch(headless, null);
}

export function resolvePlainBrowserLaunchOptions(options) {
  const headless = options.headless !== false;
  return {
    headless,
    ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
      // Persistent profiles otherwise keep every asset they ever fetched.
      `--disk-cache-size=${DISK_CACHE_BYTES}`,
      ...(!headless ? ["--window-position=-32000,-32000"] : []),
    ],
  };
}

async function launchBrowserInstance(options, headless) {
  // A headed browser must be a real windowed Chromium, so the engine
  // preference below applies to the headless path only.
  if (!headless) {
    const { chromium } = await loadRuntimeDep("playwright-core");
    // No X server (Docker image / bare VPS) → start a private Xvfb.
    const display = await ensureVirtualDisplay();
    const launchOpts = resolvePlainBrowserLaunchOptions(options);
    if (display) launchOpts.env = { ...process.env, DISPLAY: display };
    return launchChromiumWithFallback(chromium, launchOpts);
  }

  // Prefer Obscura (lightweight, browser-grade CDP) over a full Chromium;
  // fall back to cloakbrowser, then plain Chromium.
  const obscura = await connectObscuraBrowser();
  if (obscura) {
    state.engine = "obscura";
    return obscura.browser;
  }

  const cloakLaunch = await resolveCloakLaunch();
  if (cloakLaunch) {
    state.engine = "cloakbrowser";
    return cloakLaunch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }

  // Fallback: plain Playwright Chromium. Works for cookie-only auth flows,
  // but strong anti-bot challenges detect this Chromium build.
  state.engine = "chromium";
  const { chromium } = await loadRuntimeDep("playwright-core");
  return launchChromiumWithFallback(chromium, resolvePlainBrowserLaunchOptions(options));
}

async function launchBrowser(options) {
  const headless = options.headless !== false;
  const existing = currentBrowser(headless);
  if (existing) return existing;
  const pending = currentBrowserLaunch(headless);
  if (pending) return pending;
  const generation = state.generation;
  const launch = (async () => {
    const browser = await launchBrowserInstance(options, headless);

    if (state.generation !== generation) {
      await browser.close().catch(() => {});
      throw new Error("Pool shut down during browser launch");
    }
    setCurrentBrowser(headless, browser);
    state.metrics.browserLaunches++;
    return browser;
  })();
  setBrowserLaunch(headless, launch);
  try {
    const browser = await launch;
    clearBrowserLaunch(headless, launch);
    return browser;
  } catch (err) {
    clearBrowserLaunch(headless, launch);
    state.metrics.browserLaunchFailures++;
    throw err;
  }
}

const COOKIE_ATTR_NAMES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "secure",
  "httponly",
  "samesite",
]);

export function parseCookieString(raw, domain) {
  const domainStr = String(domain || "");
  const bareDomain = domainStr.replace(/^\./, "");
  const dottedDomain = bareDomain ? `.${bareDomain}` : "";
  return raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return null;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || !value) return null;
      if (COOKIE_ATTR_NAMES.has(name.toLowerCase())) return null;
      return {
        name,
        value,
        domain: name.startsWith("__Host-") ? bareDomain : (domainStr.startsWith(".") ? domainStr : dottedDomain),
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      };
    })
    .filter(Boolean);
}

// Clear a key from the pending-creation map once its promise settles, counting failures.
function settlePendingContext(key, failed) {
  if (failed) state.metrics.contextCreateFailures++;
  state.pendingContexts.delete(key);
}

// Seed a freshly created context with whatever session material the caller
// supplied — cookies for cookie-auth providers, localStorage for the ones whose
// session is a Bearer JWT the page reads at boot.
async function seedContextSession(context, options) {
  if (options.cookieString) {
    const cookies = parseCookieString(options.cookieString, options.cookieDomain);
    if (cookies.length > 0) {
      await context.addCookies(cookies);
    }
  }

  if (!options.localStorage || Object.keys(options.localStorage).length === 0) return;

  const origin = new URL(options.localStorageOrigin || options.warmupUrl || "").origin;
  await context.addInitScript(
    ({ expectedOrigin, entries }) => {
      if (window.location.origin !== expectedOrigin) return;
      for (const [name, value] of entries) {
        window.localStorage.setItem(name, value);
      }
    },
    {
      expectedOrigin: origin,
      entries: Object.entries(options.localStorage),
    }
  );
}

async function createWarmupPage(context, warmupUrl) {
  if (!warmupUrl) return null;
  let page = null;
  try {
    page = await context.newPage();
    await page.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    // Give the warmup a moment for upstream status/auth/country requests. The
    // first chat request otherwise pays this cost on the hot path.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return page;
  } catch {
    await page?.close().catch(() => {});
    return null;
  }
}

/**
 * Acquire (or reuse) a browser context for `key`. Options:
 *   cookieDomain      — domain to seed cookieString on (required with cookieString)
 *   cookieString      — raw Cookie header value to seed
 *   storageState      — Playwright storageState (from an authenticated session)
 *   localStorage      — entries seeded via addInitScript (origin-scoped)
 *   localStorageOrigin — origin for localStorage seeding (default: warmupUrl origin)
 *   warmupUrl         — page opened once at context creation (auth/status warmup)
 *   userAgent / locale / timezone
 *   headless          — false for flows that reject headless Chromium
 *   executablePath    — system Chrome path, headed contexts only
 */
export async function acquireBrowserContext(key, options) {
  if (!isPoolEnabled()) {
    throw new Error(
      "browserPool: NINEROUTER_BROWSER_POOL=off — context requested but pool is disabled"
    );
  }
  const headless = options.headless !== false;
  const poolKey = `${headless ? "headless" : "headed"}:${key}`;
  const existing = state.contexts.get(poolKey);
  if (existing) {
    existing.lastUsed = Date.now();
    state.lastActivity = Date.now();
    state.metrics.contextsReused++;
    resetIdleTimer();
    return existing;
  }

  // Dedup concurrent creations for the same key
  const pending = state.pendingContexts.get(poolKey);
  if (pending) return pending.promise;

  const createPromise = (async () => {
    const browser = await launchBrowser(options);
    const isStealth = headless && (state.engine === "obscura" || state.cloakLaunch !== null);
    const context = await browser.newContext({
      userAgent: options.userAgent || DEFAULT_USER_AGENT,
      locale: options.locale || "en-US",
      timezoneId: options.timezone || "America/New_York",
      viewport: { width: 1280, height: 800 },
      ...(options.storageState ? { storageState: options.storageState } : {}),
    });

    await seedContextSession(context, options);
    const warmupPage = await createWarmupPage(context, options.warmupUrl);

    // Guard: if shutdownPool() ran while we were creating this context,
    // the browser we obtained is now closed. Close our temp context and
    // throw so the caller knows to retry.
    if (currentBrowser(headless) !== browser) {
      await context.close().catch(() => {});
      if (warmupPage) {
        await warmupPage.close().catch(() => {});
      }
      throw new Error("Pool shut down during context creation");
    }

    const pooled = {
      id: poolKey,
      context,
      warmupPage,
      lastUsed: Date.now(),
      isStealth,
    };
    state.contexts.set(poolKey, pooled);
    state.metrics.contextsCreated++;
    state.lastActivity = Date.now();
    resetIdleTimer();
    startEvictTimer();
    return pooled;
  })();

  state.pendingContexts.set(poolKey, { promise: createPromise, createdAt: Date.now() });
  createPromise
    .then(() => settlePendingContext(poolKey, false))
    .catch(() => settlePendingContext(poolKey, true));

  return createPromise;
}

export async function openPage(pooled) {
  return pooled.context.newPage();
}

export async function releaseBrowserContext(key) {
  const resolvedKey = [key, `headless:${key}`, `headed:${key}`].find((candidate) =>
    state.contexts.has(candidate)
  );
  if (!resolvedKey) return;
  const pooled = state.contexts.get(resolvedKey);
  if (!pooled) return;
  state.contexts.delete(resolvedKey);
  state.metrics.contextsReleased++;
  try {
    await pooled.context.close();
  } catch {
    /* ignore */
  }
  if (state.contexts.size === 0) {
    await shutdownPool("last-context-closed");
  }
}

export async function shutdownPool(reason) {
  state.generation++;
  state.metrics.shutdowns++;
  state.metrics.lastShutdownReason = reason;
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (state.evictTimer) {
    clearInterval(state.evictTimer);
    state.evictTimer = null;
  }
  state.pendingContexts.clear();
  for (const [key, pooled] of state.contexts) {
    try {
      await pooled.context.close();
    } catch {
      /* ignore */
    }
    state.contexts.delete(key);
  }
  if (state.browser) {
    try {
      await state.browser.close();
    } catch {
      /* ignore */
    }
    state.browser = null;
  }
  if (state.headedBrowser) {
    try {
      await state.headedBrowser.close();
    } catch {
      /* ignore */
    }
    state.headedBrowser = null;
  }
  state.launching = null;
  state.headedLaunching = null;
  stopVirtualDisplay();
  // The shared Obscura server is owned by ./obscura.js and reused across
  // acquires, so closing the pool's CDP connection is enough — never kill the
  // server here.
  state.engine = null;
  state.lastActivity = Date.now();
}

export function getBrowserPoolStatus() {
  return {
    enabled: isPoolEnabled(),
    contexts: state.contexts.size,
    browserRunning: state.browser !== null || state.headedBrowser !== null,
    engine: state.engine,
    stealthAvailable: state.engine === "obscura" || state.cloakLaunch !== null,
    lastActivityAgoMs: state.lastActivity === 0 ? -1 : Date.now() - state.lastActivity,
  };
}

/** Browser-pool observability: live status plus cumulative lifecycle telemetry. */
export function getBrowserPoolMetrics() {
  return { status: getBrowserPoolStatus(), metrics: { ...state.metrics } };
}

/** Test-only: reset cumulative metrics so assertions start from a clean slate. */
export function __resetBrowserPoolMetricsForTest() {
  state.metrics = createBrowserPoolMetrics();
}

export async function readPageResponseBody(response) {
  const headers = {};
  for (const [name, value] of Object.entries(response.headers())) {
    headers[name] = value;
  }
  const body = await response.body();
  return { status: response.status(), headers, body: Buffer.from(body) };
}
