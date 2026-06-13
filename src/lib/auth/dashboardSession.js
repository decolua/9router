import { SignJWT, jwtVerify } from "jose";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";

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

// Single canonical TTL in seconds — drives both JWT exp and cookie maxAge so they
// cannot diverge. Accepts "Nd" / "Nh" / "Nm" or a plain integer (seconds).
// Clamped to [60, 30 days]. Defaults to 30 days.
const MAX_SESSION_S = 30 * 86400;
function parseTtlSeconds(raw) {
  const s = String(raw || "").trim();
  const unit = { d: 86400, h: 3600, m: 60 };
  const m = s.match(/^(\d+)(d|h|m)$/);
  if (m) return Math.min(parseInt(m[1], 10) * unit[m[2]], MAX_SESSION_S);
  const n = parseInt(s, 10);
  if (!isNaN(n) && n > 0) return Math.min(n, MAX_SESSION_S);
  return MAX_SESSION_S;
}
const SESSION_MAX_AGE_S = parseTtlSeconds(process.env.AUTH_SESSION_TTL);

export async function createDashboardAuthToken(claims = {}) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_S;
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  if (!token) return false;
  try {
    await jwtVerify(token, SECRET);
    return true;
  } catch {
    return false;
  }
}

export async function getDashboardAuthSession(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return payload;
  } catch {
    return null;
  }
}

export async function setDashboardAuthCookie(cookieStore, request, claims = {}) {
  const token = await createDashboardAuthToken(claims);
  cookieStore.set("auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export function clearDashboardAuthCookie(cookieStore) {
  cookieStore.delete("auth_token");
}
