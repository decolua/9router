// Interactive web login capture for web-cookie providers.
//
// Opens a persistent HEADED Chrome window at the provider's login page using a
// per-provider profile under <DATA_DIR>/browser-profiles/web-login/. The user
// logs in by hand (and clears any Cloudflare challenge in that window); we
// poll the context until every required token from webLoginConfig is present,
// then serialize the whole cookie jar as a paste-equivalent credential.
//
// The profile persists, so a repeat login usually finds the session still
// alive and resolves in one poll — and a warm profile keeps cf_clearance.

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { join } from "node:path";
import { loadRuntimeDep } from "./lazyRuntime.js";
import { getWebLoginConfig } from "./webLoginConfig.js";
import { getWritableDataDir } from "../utils/writableDataDir.js";
import { pruneProfileCaches, formatBytes } from "./browserProfileCache.js";
import { resolveSystemChromeExecutable } from "../executors/browserExecutableCheck.js";

const POLL_INTERVAL_MS = 1500;
const LOGIN_TIMEOUT_MS = 300000;

// Shared browser profiles: one Google login in a profile makes every
// "Continue with Google" provider login a single click.
function profileDir(profileName) {
  return path.join(getWritableDataDir(), "browser-profiles", sanitizeProfileName(profileName));
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

// providerId -> { status, startedAt, credential?, error? }
const sessions = new Map();

// One Chromium lock per profile dir: a second launch on the same persistent
// profile fails, so refuse up front with an actionable message.
const busyProfiles = new Map(); // profileName -> providerId

export function getWebLoginStatus(providerId) {
  return sessions.get(providerId) || null;
}

/** Existing browser profiles the user can pick from (shared across providers). */
export function listWebLoginProfiles() {
  const root = path.join(getWritableDataDir(), "browser-profiles");
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "web-login")
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function cancelWebLogin(providerId) {
  const session = sessions.get(providerId);
  if (!session || session.status !== "running") return false;
  session.cancelled = true;
  return true;
}

/** "default" unless the user picked/created a named profile. */
function sanitizeProfileName(name) {
  const cleaned = String(name || "").trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
  return cleaned || "default";
}

export async function startWebLogin(providerId, profileName = "default") {
  const config = getWebLoginConfig(providerId);
  if (!config) throw new Error(`No web-login config for provider "${providerId}"`);
  const existing = sessions.get(providerId);
  if (existing?.status === "running") return existing;
  const profile = sanitizeProfileName(profileName);
  if (busyProfiles.has(profile)) {
    throw new Error(`Profile "${profile}" is already open for ${busyProfiles.get(profile)} — finish that login first or pick another profile`);
  }

  const session = { providerId, profile, status: "running", startedAt: Date.now(), cancelled: false };
  sessions.set(providerId, session);
  busyProfiles.set(profile, providerId);
  // Fire-and-forget: callers poll getWebLoginStatus().
  runLogin(session, config)
    .catch((error) => {
      session.status = "error";
      session.error = error?.message || String(error);
    })
    .finally(() => busyProfiles.delete(profile));
  return session;
}

// Chromium leaves Singleton* lock files when a launch is killed; a stale lock
// makes every next launch fail with "ProcessSingleton". Remove and retry once.
function clearStaleSingletonLocks(dir) {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { rmSync(join(dir, name), { force: true }); } catch { /* best-effort */ }
  }
}

async function launchLoginBrowser(chromium, dir, executablePath) {
  try {
    return await chromium.launchPersistentContext(dir, {
      headless: false,
      executablePath,
      viewport: null,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  } catch (error) {
    if (!/ProcessSingleton|SingletonLock/i.test(String(error?.message || ""))) throw error;
    clearStaleSingletonLocks(dir);
    return await chromium.launchPersistentContext(dir, {
      headless: false,
      executablePath,
      viewport: null,
      args: ["--disable-blink-features=AutomationControlled"],
    });
  }
}

async function runLogin(session, config) {
  const { chromium } = await loadRuntimeDep("playwright-core");
  const executablePath = resolveSystemChromeExecutable();
  if (!executablePath) {
    throw new Error("No Chrome/Chromium executable found — set CHROME_PATH or install Google Chrome");
  }
  const dir = profileDir(session.profile);
  mkdirSync(dir, { recursive: true });

  const context = await launchLoginBrowser(chromium, dir, executablePath);

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (session.cancelled) {
        session.status = "cancelled";
        return;
      }
      await page.waitForTimeout(POLL_INTERVAL_MS);
      const found = await harvest(context, config);
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
      session.status = "success";
      return;
    }
    session.status = "timeout";
    session.error = "Login window timed out after 5 minutes — try again";
  } finally {
    await context.close().catch(() => {});
    clearStaleSingletonLocks(dir);
    // Chrome's caches balloon far past the session data we keep; drop them
    // while the profile is closed and rebuilding is free.
    const pruned = pruneProfileCaches(dir);
    if (pruned.freedBytes > 0) {
      console.log("[webLogin] pruned", formatBytes(pruned.freedBytes), "from profile", session.profile);
    }
  }
}
