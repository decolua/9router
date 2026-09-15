import { NextResponse } from "next/server";
import { execFileSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import factory from "@/lib/oauth/providers/factory";
import { createProviderConnection } from "@/models";

const FACTORY_DIR = path.join(os.homedir(), ".factory");
const LOGIN_KEYCHAIN_PATH = path.join(FACTORY_DIR, "auth.v2.loginkeychain");
const FILE_STORAGE_PATH = path.join(FACTORY_DIR, "auth.v2.file");
const KEYFILE_PATH = path.join(FACTORY_DIR, "auth.v2.key");

const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export function decryptPayload(ciphertext, key) {
  if (!ciphertext || typeof ciphertext !== "string" || !key) return null;
  const parts = ciphertext.trim().split(":");
  if (parts.length !== 3) return null;

  const iv = Buffer.from(parts[0], "base64");
  const authTag = Buffer.from(parts[1], "base64");
  const encryptedData = Buffer.from(parts[2], "base64");

  if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
    return null;
  }

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function encryptPayload(payload, key) {
  if (!payload || !key) return null;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const encrypted = Buffer.concat([cipher.update(json), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
  } catch {
    return null;
  }
}

export function readKeychainKey() {
  if (process.platform !== "darwin") return null;
  try {
    const stdout = execFileSync(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Factory CLI", "-w"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (stdout.length > 0) {
      return Buffer.from(stdout, "base64");
    }
  } catch {
    // Keychain item unavailable or access denied
  }
  return null;
}

export function readKeyfileKey() {
  try {
    if (fs.existsSync(KEYFILE_PATH)) {
      const raw = fs.readFileSync(KEYFILE_PATH, "utf8").trim();
      if (raw.length > 0) {
        return Buffer.from(raw, "base64");
      }
    }
  } catch {
    // Keyfile unreadable
  }
  return null;
}

export function loadDroidCliCredentials() {
  // 1. Try macOS Keychain
  const keychainKey = readKeychainKey();
  if (keychainKey && fs.existsSync(LOGIN_KEYCHAIN_PATH)) {
    try {
      const encrypted = fs.readFileSync(LOGIN_KEYCHAIN_PATH, "utf8");
      const decrypted = decryptPayload(encrypted, keychainKey);
      if (decrypted && typeof decrypted.access_token === "string" && typeof decrypted.refresh_token === "string") {
        return {
          accessToken: decrypted.access_token,
          refreshToken: decrypted.refresh_token,
          activeOrganizationId: decrypted.active_organization_id || undefined,
        };
      }
    } catch {
      // Continue to file-backed key
    }
  }

  // 2. Try file-backed key (auth.v2.key + auth.v2.file or auth.v2.loginkeychain)
  const fileKey = readKeyfileKey();
  if (fileKey) {
    const candidatePaths = [FILE_STORAGE_PATH, LOGIN_KEYCHAIN_PATH];
    for (const candidatePath of candidatePaths) {
      if (fs.existsSync(candidatePath)) {
        try {
          const encrypted = fs.readFileSync(candidatePath, "utf8");
          const decrypted = decryptPayload(encrypted, fileKey);
          if (decrypted && typeof decrypted.access_token === "string" && typeof decrypted.refresh_token === "string") {
            return {
              accessToken: decrypted.access_token,
              refreshToken: decrypted.refresh_token,
              activeOrganizationId: decrypted.active_organization_id || undefined,
            };
          }
        } catch {
          // Continue
        }
      }
    }
  }

  return null;
}

export function saveDroidCliCredentials(creds) {
  if (!creds?.accessToken || !creds?.refreshToken) return false;
  const payload = {
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    ...(creds.activeOrganizationId ? { active_organization_id: creds.activeOrganizationId } : {}),
  };

  // 1. Try macOS Keychain
  const keychainKey = readKeychainKey();
  if (keychainKey && fs.existsSync(LOGIN_KEYCHAIN_PATH)) {
    try {
      const encrypted = encryptPayload(payload, keychainKey);
      if (encrypted) {
        fs.writeFileSync(LOGIN_KEYCHAIN_PATH, encrypted, { mode: 0o600 });
        return true;
      }
    } catch {
      // Continue
    }
  }

  // 2. Try file-backed key
  const fileKey = readKeyfileKey();
  if (fileKey && fs.existsSync(FILE_STORAGE_PATH)) {
    try {
      const encrypted = encryptPayload(payload, fileKey);
      if (encrypted) {
        fs.writeFileSync(FILE_STORAGE_PATH, encrypted, { mode: 0o600 });
        return true;
      }
    } catch {
      // Continue
    }
  }

  return false;
}

/**
 * GET /api/oauth/factory/auto-import
 * Check if local Factory Droid CLI credentials exist and discover identity.
 */
export async function GET() {
  try {
    const creds = loadDroidCliCredentials();
    if (!creds || !creds.accessToken) {
      return NextResponse.json({
        found: false,
        error: "No local Factory Droid session detected in ~/.factory",
      });
    }

    const extra = await factory.postExchange({ access_token: creds.accessToken });
    if (!extra.orgId && creds.activeOrganizationId) {
      extra.orgId = creds.activeOrganizationId;
    }
    extra.isLocalCli = true;

    const mapped = factory.mapTokens(
      {
        access_token: creds.accessToken,
        refresh_token: creds.refreshToken,
      },
      extra
    );

    return NextResponse.json({
      found: true,
      email: mapped.email,
      displayName: mapped.displayName,
      orgId: mapped.providerSpecificData?.orgId || creds.activeOrganizationId || null,
      region: mapped.providerSpecificData?.region || null,
      hasRefreshToken: !!creds.refreshToken,
    });
  } catch (error) {
    return NextResponse.json({
      found: false,
      error: error.message || "Failed to inspect local Droid CLI credentials",
    });
  }
}

/**
 * POST /api/oauth/factory/auto-import
 * Import local Factory Droid CLI credentials directly into 9router connection.
 */
export async function POST() {
  try {
    const creds = loadDroidCliCredentials();
    if (!creds || !creds.accessToken) {
      return NextResponse.json(
        { error: "No local Factory Droid session detected to import" },
        { status: 404 }
      );
    }

    const extra = await factory.postExchange({ access_token: creds.accessToken });
    if (!extra.orgId && creds.activeOrganizationId) {
      extra.orgId = creds.activeOrganizationId;
    }
    extra.isLocalCli = true;

    const tokens = factory.mapTokens(
      {
        access_token: creds.accessToken,
        refresh_token: creds.refreshToken,
      },
      extra
    );

    const connection = await createProviderConnection({
      provider: "factory",
      authType: "oauth",
      ...tokens,
      expiresAt: tokens.expiresAt || (tokens.expiresIn
        ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
        : null),
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        displayName: connection.displayName,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to import Factory Droid credentials" },
      { status: 500 }
    );
  }
}
