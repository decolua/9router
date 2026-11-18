// Persistent headed browser sessions shared by provider login and the browser workspace.
// Provider logins poll configured credentials and close automatically; standalone
// sessions stay open until Stop, browser close, or their fixed 30-minute timeout.
// Both use the same profiles, launch path, profile locks, and capability transport.

import { mkdirSync, readdirSync, rmSync, lstatSync, realpathSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { join } from "node:path";
import { loadRuntimeDep } from "./lazyRuntime.js";
import { getWebLoginConfig } from "./webLoginConfig.js";
import { getWritableDataDir } from "../utils/writableDataDir.js";
import { pruneProfileCaches, formatBytes } from "./browserProfileCache.js";
import { resolveSystemChromeExecutable } from "../executors/browserExecutableCheck.js";
import { ensureVirtualDisplay } from "./virtualDisplay.js";
import remoteLogin from "../../realtime/web-login-websocket.cjs";

const POLL_INTERVAL_MS = 1500;
const LOGIN_TIMEOUT_MS = 300000;
const BROWSER_TIMEOUT_MS = 30 * 60 * 1000;
const RESERVED_PROFILES = new Set(["web-login", "zcode-captcha"]);

function profileError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function validateProfileName(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(name) || RESERVED_PROFILES.has(name)) {
    throw profileError("Profile name must be 1–40 ASCII letters, numbers, underscores or hyphens, and not a reserved name");
  }
  return name;
}

function directoryExists(dir) {
  try {
    const stat = lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw profileError("Browser profile path must be a real directory", 409);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function profilesRoot() {
  const base = realpathSync(getWritableDataDir());
  const root = path.join(base, "browser-profiles");
  if (!directoryExists(root)) mkdirSync(root);
  const defaultDir = path.join(root, "default");
  if (!directoryExists(defaultDir)) mkdirSync(defaultDir);
  return root;
}

// Shared browser profiles: one Google login in a profile makes every
// "Continue with Google" provider login a single click.
function profileDir(profileName) {
  const name = validateProfileName(profileName);
  const root = profilesRoot();
  const dir = path.resolve(root, name);
  if (path.dirname(dir) !== root) throw profileError("Invalid browser profile path");
  directoryExists(dir);
  return dir;
}

function matchesDomain(cookieDomain, cookie) {
  const want = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
  const host = String(cookie.domain || "").replace(/^\./, "").toLowerCase();
  return !want || host === want || host.endsWith(`.${want}`);
}

/** Direct cookie value, or the joined `.0/.1/…` chunks (NextAuth/Supabase split large values). */
function findCookieValue(jar, source) {
  for (const name of [source.name, ...(source.names || [])]) {
    if (!name) continue;
    const direct = jar.get(name);
    if (direct) return direct;
    const chunks = new Map();
    for (const [cookieName, value] of jar) {
      if (!cookieName.startsWith(`${name}.`)) continue;
      const idx = Number(cookieName.split(".").pop());
      if (Number.isInteger(idx)) chunks.set(idx, value);
    }
    const joined = [];
    for (let i = 0; chunks.has(i); i++) joined.push(chunks.get(i));
    if (joined.length) return joined.join("");
  }
  return null;
}

/**
 * Read the required tokens from a live browser context.
 * Returns { ready, cookieHeader, localStorageValues }.
 * Exported so the login flow can be exercised without a real browser.
 */
export async function harvest(context, config) {
  const cookies = (await context.cookies()).filter((cookie) => matchesDomain(config.cookieDomain, cookie));
  const jar = new Map(cookies.map((cookie) => [cookie.name, cookie.value]));
  const localStorageValues = {};
  for (const page of context.pages()) {
    if (localStorageValues[config.tokenSources[0]?.name]) break;
    try {
      const url = page.url();
      if (!/^https?:/.test(url)) continue;
      const found = await page.evaluate((names) => {
        const out = {};
        for (const name of names) {
          const value = window.localStorage?.getItem(name);
          if (value) out[name] = value;
        }
        return out;
      }, config.tokenSources.filter((source) => source.type === "localStorage").map((source) => source.name));
      Object.assign(localStorageValues, found);
    } catch {
      // Page may be mid-navigation; try the next page.
    }
  }
  const ready = config.tokenSources.every((source) => {
    const value = source.type === "cookie"
      ? findCookieValue(jar, source)
      : (localStorageValues[source.name] || null);
    // Optional sources enrich the credential without gating completion.
    if (source.optional) return true;
    if (!value) return false;
    if (source.validateCookie) return source.validateCookie(value);
    if (source.validateToken) return source.validateToken(value);
    if (config.validateToken) return config.validateToken(value);
    if (config.validateCookie) return config.validateCookie(value);
    return true;
  });
  const cookieHeader = cookies
    .filter((cookie) => cookie.value)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  return { ready, cookieHeader, localStorageValues };
}

// Shared with the unbundled custom server through Symbol.for, not module caches.
const { registry, registerSession, attachContext, revokeSession } = remoteLogin;
const { sessions, busyProfiles } = registry;
const browserSessions = registry.browserSessions ||= new Map();

export function getWebLoginStatus(providerId) {
  return sessions.get(providerId) || null;
}

/** Existing browser profiles the user can pick from (shared across providers). */
export function listBrowserProfiles() {
  const root = profilesRoot();
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[A-Za-z0-9_-]{1,40}$/.test(entry.name) && !RESERVED_PROFILES.has(entry.name))
    .map((entry) => ({ name: entry.name, busy: busyProfiles.has(entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listWebLoginProfiles() {
  return listBrowserProfiles().map(({ name }) => name);
}

export function createBrowserProfile(name) {
  const dir = profileDir(name);
  if (directoryExists(dir)) throw profileError(`Profile "${name}" already exists`, 409);
  mkdirSync(dir);
  return { name, busy: false };
}

function mutableProfile(name) {
  const dir = profileDir(name);
  if (name === "default") throw profileError("The default profile cannot be renamed or deleted", 409);
  if (busyProfiles.has(name)) throw profileError(`Profile "${name}" is already open`, 409);
  if (!directoryExists(dir)) throw profileError("Profile not found", 404);
  return dir;
}

export function renameBrowserProfile(name, newName) {
  const dir = mutableProfile(name);
  const destination = profileDir(newName);
  if (busyProfiles.has(newName) || directoryExists(destination)) throw profileError(`Profile "${newName}" already exists or is open`, 409);
  renameSync(dir, destination);
  return { name: newName, busy: false };
}

export function deleteBrowserProfile(name) {
  rmSync(mutableProfile(name), { recursive: true });
  return true;
}

function browserSessionResponse(session) {
  return {
    id: session.id, profile: session.profile, status: session.status, error: session.error || null,
    viewer: session.status === "running" && session.viewerToken ? { token: session.viewerToken } : null,
  };
}

export function listBrowserSessions() {
  return Array.from(browserSessions.values()).filter((session) => session.status === "running").map(browserSessionResponse);
}

export function getBrowserSession(id) {
  const session = browserSessions.get(id);
  return session ? browserSessionResponse(session) : null;
}

export async function startBrowserSession(profile, url) {
  if (!remoteLogin.validNavigationUrl(url)) throw profileError("URL must be http(s), at most 4096 characters, with no username or password");
  const dir = profileDir(profile);
  if (!directoryExists(dir)) throw profileError("Profile not found", 404);
  if (busyProfiles.has(profile)) throw profileError(`Profile "${profile}" is already open`, 409);
  const session = { id: randomUUID(), kind: "standalone", profile, url, status: "running", startedAt: Date.now(), abort: new AbortController(), context: null };
  browserSessions.set(session.id, session);
  busyProfiles.set(profile, session);
  registerSession(session);
  session.timer = setTimeout(() => finishSession(session, "timeout", "Browser session reached its 30-minute limit"), BROWSER_TIMEOUT_MS);
  session.timer.unref?.();
  void runLogin(session, null).catch((error) => finishSession(session, "error", error?.message || String(error)));
  return browserSessionResponse(session);
}

export function closeBrowserSession(id) {
  const session = browserSessions.get(id);
  if (!session || session.status !== "running") return false;
  finishSession(session, "cancelled");
  return true;
}

export function cancelWebLogin(providerId) {
  const session = sessions.get(providerId);
  if (!session || session.status !== "running") return false;
  finishSession(session, "cancelled");
  return true;
}

export async function startWebLogin(providerId, profileName = "default") {
  const config = getWebLoginConfig(providerId);
  if (!config) throw new Error(`No web-login config for provider "${providerId}"`);
  const existing = sessions.get(providerId);
  if (existing?.status === "running") return existing;
  const profile = validateProfileName(profileName);
  profileDir(profile);
  if (busyProfiles.has(profile)) {
    throw profileError(`Profile "${profile}" is already open — finish that browser session or pick another profile`, 409);
  }

  const session = { providerId, profile, status: "running", startedAt: Date.now(), abort: new AbortController(), context: null };
  sessions.set(providerId, session);
  busyProfiles.set(profile, session);
  registerSession(session);
  session.timer = setTimeout(() => finishSession(session, "timeout", "Login window timed out after 5 minutes — try again"), LOGIN_TIMEOUT_MS);
  session.timer.unref?.();
  // Return the capability before dependency loading or Chromium startup finishes.
  void runLogin(session, config).catch((error) => finishSession(session, "error", error?.message || String(error)));
  return session;
}

function closeContext(session) {
  if (session.context && !session.closing) session.closing = session.context.close().catch(() => {});
  return session.closing;
}

function finishSession(session, status, error) {
  if (session.status !== "running") return;
  session.status = status;
  if (error) session.error = error;
  clearTimeout(session.timer);
  revokeSession(session);
  session.abort.abort();
  void closeContext(session);
}

function waitForPoll(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, POLL_INTERVAL_MS);
    signal.addEventListener("abort", done, { once: true });
  });
}

// Chromium leaves Singleton* lock files when a launch is killed; a stale lock
// makes every next launch fail with "ProcessSingleton". Remove and retry once.
function clearStaleSingletonLocks(dir) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { rmSync(join(dir, name), { force: true }); } catch { /* best-effort */ }
  }
}

async function launchLoginBrowser(chromium, dir, executablePath, display) {
  const options = {
    headless: false,
    executablePath,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    timeout: 30000,
    env: { ...process.env, ...(display ? { DISPLAY: display } : {}) },
    args: ["--disable-blink-features=AutomationControlled"],
  };
  try {
    return await chromium.launchPersistentContext(dir, options);
  } catch (error) {
    if (!/ProcessSingleton|SingletonLock/i.test(String(error?.message || ""))) throw error;
    clearStaleSingletonLocks(dir);
    return await chromium.launchPersistentContext(dir, options);
  }
}

async function runLogin(session, config) {
  let dir;
  let onClose;
  try {
    const { chromium } = await loadRuntimeDep("playwright-core");
    if (session.status !== "running") return;
    const executablePath = resolveSystemChromeExecutable();
    if (!executablePath) throw new Error("No Chrome/Chromium executable found — set CHROME_PATH or install Google Chrome");
    const display = await ensureVirtualDisplay();
    if (session.status !== "running") return;
    dir = profileDir(session.profile);
    if (!directoryExists(dir)) mkdirSync(dir);
    const context = await launchLoginBrowser(chromium, dir, executablePath, display);
    session.context = context;
    session.contextClosed = new Promise((resolve) => context.once("close", resolve));
    // A cancelled/expired pending launch still owns its profile until this close finishes.
    if (session.status !== "running") return;
    onClose = () => finishSession(session, config ? "error" : "cancelled", config ? "Login browser closed before login completed" : undefined);
    context.once("close", onClose);
    attachContext(session, context);
    const page = context.pages()[0] || (await context.newPage());
    if (session.status !== "running") return;
    // Navigation can stall on challenges: neither polling nor cancellation waits for it.
    void page.goto(config ? config.loginUrl : session.url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    if (!config) {
      await new Promise((resolve) => {
        if (session.abort.signal.aborted) resolve();
        else session.abort.signal.addEventListener("abort", resolve, { once: true });
      });
      return;
    }

    while (session.status === "running") {
      await waitForPoll(session.abort.signal);
      if (session.status !== "running") return;
      const found = await harvest(context, config);
      if (session.status !== "running") return;
      if (!found.ready) continue;
      if (config.credentialFrom === "localStorageValue") {
        const source = config.tokenSources[0];
        let val = found.localStorageValues[source.name];
        try {
          const parsed = JSON.parse(val);
          if (parsed && typeof parsed.value === "string") val = parsed.value;
        } catch {
          // not JSON, keep raw
        }
        session.credential = val;
      } else {
        session.credential = found.cookieHeader;
      }
      finishSession(session, "success");
    }
  } finally {
    if (onClose) session.context.off("close", onClose);
    await closeContext(session);
    if (session.contextClosed) await session.contextClosed;
    session.context = null;
    if (dir) {
      clearStaleSingletonLocks(dir);
      const pruned = pruneProfileCaches(dir);
      if (pruned.freedBytes > 0) console.log("[webLogin] pruned", formatBytes(pruned.freedBytes), "from profile", session.profile);
    }
    if (busyProfiles.get(session.profile) === session) busyProfiles.delete(session.profile);
    if (session.kind === "standalone") browserSessions.delete(session.id);
  }
}
