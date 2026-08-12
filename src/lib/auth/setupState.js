// Bootstrap state for dashboard auth.
//
// There is no built-in default password. A brand-new install starts in the
// "setup" state: the server prints a one-time setup token to its console and
// the dashboard is locked until someone completes /setup with that token.
//
// States:
//   configured — a password hash is stored; normal password login
//   oidc       — no password, but OIDC is the configured auth mode
//   env        — operator supplied INITIAL_PASSWORD (headless/Docker bootstrap)
//   legacy     — pre-existing install that was still on the old default
//                password; one last login is allowed, then a change is forced
//   setup      — nothing configured; console setup token required
import { getSettings } from "@/lib/localDb";
import { getMeta, setMeta } from "@/lib/db/helpers/metaStore.js";
import { isOidcConfigured } from "@/lib/auth/oidc";

export const MIN_PASSWORD_LENGTH = 8;

// The password shipped as the default before the setup flow existed. Only ever
// accepted for installs stamped as legacy, and only until a real one is set.
export const LEGACY_DEFAULT_PASSWORD = "123456";

// _meta key stamped by the DB migration for installs that predate this flow.
export const LEGACY_GRACE_META_KEY = "legacyDefaultPassword";

let warnedWeakEnvPassword = false;

// INITIAL_PASSWORD is an explicit operator choice (Docker/compose bootstrap),
// so it is honoured — but not if it is too weak to be worth honouring.
export function getEnvInitialPassword() {
  const raw = process.env.INITIAL_PASSWORD;
  if (typeof raw !== "string" || !raw) return null;
  if (raw.length < MIN_PASSWORD_LENGTH || raw === LEGACY_DEFAULT_PASSWORD) {
    if (!warnedWeakEnvPassword) {
      warnedWeakEnvPassword = true;
      console.warn(
        `[Auth] INITIAL_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters — ignoring it. ` +
        `Complete first-run setup with the console token instead.`
      );
    }
    return null;
  }
  return raw;
}

export function validateNewPassword(password) {
  if (typeof password !== "string" || !password) {
    return { ok: false, error: "Password is required" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { ok: true };
}

export async function getAuthBootstrapState(settings = null) {
  let s = settings;
  if (!s) {
    try {
      s = await getSettings();
    } catch {
      // DB unreadable — assume configured so we fail closed rather than
      // handing out a setup flow on a broken install.
      return "configured";
    }
  }
  if (s?.password) return "configured";
  if (s?.authMode === "oidc" && isOidcConfigured(s)) return "oidc";
  if (getEnvInitialPassword()) return "env";

  let legacy = false;
  try {
    legacy = (await getMeta(LEGACY_GRACE_META_KEY, "0")) === "1";
  } catch {
    legacy = false;
  }
  return legacy ? "legacy" : "setup";
}

export async function needsSetup(settings = null) {
  return (await getAuthBootstrapState(settings)) === "setup";
}

// The secret that stands in for a stored hash in the "env" and "legacy" states.
export async function getBootstrapSecret(settings = null) {
  const state = await getAuthBootstrapState(settings);
  if (state === "env") return getEnvInitialPassword();
  if (state === "legacy") return LEGACY_DEFAULT_PASSWORD;
  return null;
}

export async function clearLegacyGrace() {
  try {
    await setMeta(LEGACY_GRACE_META_KEY, "0");
  } catch {
    /* best effort — the stored hash already takes precedence */
  }
}
