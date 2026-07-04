import fs from "node:fs";
import path from "node:path";
import { SignJWT, jwtVerify } from "jose";
import { generateTotpSecret, verifyTotp, buildOtpauthUri } from "./totp.js";
import { encryptString, decryptString } from "@/lib/db/helpers/encryptedJsonCol.js";
import { isMasterKeyConfigured } from "@/lib/crypto/masterKey.js";
import { DATA_DIR } from "@/lib/dataDir";
import { getUserMfaState, setUserMfaSecret, setUserMfaEnabled } from "@/lib/db/repos/usersRepo.js";

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    throw new Error("JWT_SECRET is required for MFA");
  }
}

let mfaSecretBytes = null;
function getMfaSecretBytes() {
  if (!mfaSecretBytes) {
    mfaSecretBytes = new TextEncoder().encode(loadJwtSecret());
  }
  return mfaSecretBytes;
}

function storeSecret(plain) {
  if (isMasterKeyConfigured()) return encryptString(plain);
  return plain;
}

function readSecret(stored) {
  if (!stored) return null;
  if (isMasterKeyConfigured()) return decryptString(stored);
  return stored;
}

export async function beginMfaSetup(userId, email) {
  const secret = generateTotpSecret();
  await setUserMfaSecret(userId, storeSecret(secret));
  return {
    secret,
    otpauthUri: buildOtpauthUri({ secret, email }),
  };
}

export async function confirmMfaSetup(userId, code) {
  const state = await getUserMfaState(userId);
  const secret = readSecret(state?.mfaSecret);
  if (!secret) throw new Error("MFA setup not started");
  if (!verifyTotp(secret, code)) throw new Error("Invalid verification code");
  await setUserMfaEnabled(userId, true);
  return true;
}

export async function disableMfa(userId, code) {
  const state = await getUserMfaState(userId);
  if (!state?.mfaEnabled) return true;
  const secret = readSecret(state?.mfaSecret);
  if (!secret || !verifyTotp(secret, code)) throw new Error("Invalid verification code");
  await setUserMfaSecret(userId, null);
  await setUserMfaEnabled(userId, false);
  return true;
}

export async function isMfaRequired(userId) {
  const state = await getUserMfaState(userId);
  return !!(state?.mfaEnabled && state?.mfaSecret);
}

export async function verifyMfaCode(userId, code) {
  const state = await getUserMfaState(userId);
  const secret = readSecret(state?.mfaSecret);
  if (!secret) return false;
  return verifyTotp(secret, code);
}

export async function createMfaChallengeToken(userId) {
  return new SignJWT({ mfaPending: true, userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(getMfaSecretBytes());
}

export async function verifyMfaChallengeToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getMfaSecretBytes());
    if (!payload?.mfaPending || !payload?.userId) return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}
