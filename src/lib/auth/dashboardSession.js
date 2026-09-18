import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";
const SESSION_MAX_AGE_SEC = 24 * 60 * 60;
// Short-lived cookie issued between "password accepted" and "MFA satisfied".
export const MFA_PENDING_COOKIE = "mfa_pending";
const MFA_PENDING_MAX_AGE_SEC = 5 * 60;
const MFA_PENDING_SCOPE = "mfa_pending";

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const generated = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(file, generated, { mode: 0o600 });
  return generated;
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export async function createDashboardAuthToken(claims = {}) {
  // `authenticated` and `scope` are set last so caller-supplied claims can
  // never downgrade a session token into something the verifier mis-reads.
  return new SignJWT({ ...claims, authenticated: true, scope: "dashboard" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    // An MFA-pending token proves only the first factor. Treating it as a
    // session would make the second factor bypassable by reusing the
    // intermediate cookie, so it is rejected everywhere a session is expected.
    if (payload?.scope === MFA_PENDING_SCOPE) return false;
    return payload?.authenticated === true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload?.scope === MFA_PENDING_SCOPE) return null;
    if (payload?.authenticated !== true) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Issue the intermediate token for a session that has passed the password
 * check but still owes a TOTP/backup code. Deliberately carries no
 * `authenticated` claim.
 */
export async function createMfaPendingToken(claims = {}) {
  return new SignJWT({ ...claims, scope: MFA_PENDING_SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MFA_PENDING_MAX_AGE_SEC}s`)
    .sign(SECRET);
}

/** Verify an MFA-pending token. Returns its payload or null. */
export async function getMfaPendingSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    if (payload?.scope !== MFA_PENDING_SCOPE) return null;
    if (payload?.authenticated === true) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setMfaPendingCookie(cookieStore, request, claims = {}) {
  const token = await createMfaPendingToken(claims);
  cookieStore.set(MFA_PENDING_COOKIE, token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: MFA_PENDING_MAX_AGE_SEC,
  });
}

export function clearMfaPendingCookie(cookieStore) {
  cookieStore.delete(MFA_PENDING_COOKIE);
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}

// Verify the current dashboard password (re-auth for sensitive actions).
export async function verifyDashboardPassword(password) {
  if (typeof password !== "string" || !password) return false;
  const settings = await getSettings();
  const storedHash = settings?.password;
  if (storedHash) return bcrypt.compare(password, storedHash);
  const initialPassword = process.env.INITIAL_PASSWORD || DEFAULT_PASSWORD;
  return password === initialPassword;
}
