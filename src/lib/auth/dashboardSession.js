import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir";
import { getSettings } from "@/lib/localDb";

const DEFAULT_PASSWORD = "123456";

import { isWeakPassword } from "@/lib/auth/passwordPolicy";

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {}
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const generated = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(file, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString("hex");
  }
}

const SECRET = new TextEncoder().encode(loadJwtSecret());

/**
 * Returns the configured or auto-generated strong initial password.
 */
export function getInitialDashboardPassword() {
  if (process.env.INITIAL_PASSWORD) return process.env.INITIAL_PASSWORD;

  const file = path.join(DATA_DIR, "initial-password");
  try {
    const persisted = fs.readFileSync(file, "utf8").trim();
    if (persisted) return persisted;
  } catch {}

  const generated = crypto.randomBytes(16).toString("hex"); // 32-character high entropy hex
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    console.log(`🔐 [AUTH] No INITIAL_PASSWORD provided. A secure random password was generated:\n🔑 Password: ${generated}\n📄 Saved to: ${file}\n`);
  } catch (err) {
    // If persistence fails due to permissions, return generated password in memory
  }
  return generated;
}

export function shouldUseSecureCookie(request) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request?.headers?.get?.("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  return forceSecureCookie || isHttpsRequest;
}

export function getCookieSameSite() {
  const configured = (process.env.AUTH_COOKIE_SAMESITE || "lax").toLowerCase();
  if (["lax", "strict", "none"].includes(configured)) return configured;
  return "lax";
}

export async function createDashboardAuthToken(claims = {}) {
  return new SignJWT({ authenticated: true, ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
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
    sameSite: getCookieSameSite(),
    path: "/",
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
  const initialPassword = getInitialDashboardPassword();
  return password === initialPassword;
}
