import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";
import { isDashboardSessionRevoked, revokeDashboardSession } from "@/lib/db/repos/dashboardSessionsRepo.js";

const DEFAULT_PASSWORD = "123456";
const SESSION_MAX_AGE_SEC = 24 * 60 * 60;

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
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime("24h")
    .sign(SECRET);
}

export async function verifyDashboardAuthToken(token) {
  return (await getDashboardAuthSession(token)) !== null;
}

async function readSignedDashboardSession(token) {
  if (typeof token !== "string" || !token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: ["HS256"] });
    return payload.authenticated === true && Number.isFinite(payload.exp) ? payload : null;
  } catch {
    return null;
  }
}

function sessionDigest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function getDashboardAuthSession(token) {
  const payload = await readSignedDashboardSession(token);
  if (!payload) return null;
  try {
    return (await isDashboardSessionRevoked(sessionDigest(token))) ? null : payload;
  } catch {
    // An unavailable revocation store must not restore signed-out sessions.
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
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

export async function clearDashboardAuthCookie(cookieStore) {
  const token = cookieStore.get("auth_token")?.value;
  const payload = await readSignedDashboardSession(token);
  if (payload) {
    // Hash the complete token so legacy sessions without jti can also sign out.
    // Do not swallow persistence errors or report success before this write.
    await revokeDashboardSession(sessionDigest(token), payload.exp);
  }
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
