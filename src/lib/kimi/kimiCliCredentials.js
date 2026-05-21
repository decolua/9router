/**
 * Credential reader for the Kimi Code (`kimi-coding`) provider.
 *
 * KimiCLI already stores the user's coding session under ~/.kimi. Reusing that
 * session avoids a second managed OAuth login and prevents extra Kimi dashboard
 * devices that can appear as "Unknown".
 */

import fs from "fs";
import os from "os";
import path from "path";

const REFRESH_SKEW_MS = 5 * 60 * 1000;

const KIMI_HOME = path.join(os.homedir(), ".kimi");
export const KIMI_CODE_CREDENTIALS = path.join(KIMI_HOME, "credentials", "kimi-code.json");

let inflightRefresh = null;

function kimiCliSetupError(message) {
  const err = new Error(message);
  err.code = "KIMI_CLI_NOT_READY";
  return err;
}

function parseExpiry(expiresAt) {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function readKimiCliCredentialFile() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(KIMI_CODE_CREDENTIALS, "utf8"));
  } catch {
    throw kimiCliSetupError(
      "KimiCLI is not logged in. Log into KimiCLI first, then retry kimi-coding."
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw kimiCliSetupError("KimiCLI credential file is invalid. Log into KimiCLI again.");
  }

  if (typeof parsed.access_token !== "string" || !parsed.access_token) {
    throw kimiCliSetupError("KimiCLI credentials are missing an access token. Log into KimiCLI again.");
  }

  return parsed;
}

function normalizeCredentials(raw) {
  return {
    accessToken: raw.access_token,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : null,
    expiresAt: typeof raw.expires_at === "string" ? raw.expires_at : null,
    expiresIn: typeof raw.expires_in === "number" ? raw.expires_in : Number(raw.expires_in || 0),
    scope: typeof raw.scope === "string" ? raw.scope : null,
    tokenType: typeof raw.token_type === "string" && raw.token_type ? raw.token_type : "Bearer",
  };
}

export function readKimiCliCredentials() {
  return normalizeCredentials(readKimiCliCredentialFile());
}

export async function getKimiCliAccessToken() {
  const creds = readKimiCliCredentials();
  const msLeft = parseExpiry(creds.expiresAt) - Date.now();

  if (!creds.expiresAt || msLeft > REFRESH_SKEW_MS) {
    return creds.accessToken;
  }

  // Refresh-on-near-expiry is intentionally fail-closed until KimiCLI's
  // credential lock/write semantics are matched. This keeps 9router from
  // corrupting ~/.kimi/credentials/kimi-code.json while KimiCLI may also be
  // writing it.
  if (!creds.refreshToken) {
    throw kimiCliSetupError("KimiCLI token is expired. Refresh KimiCLI login, then retry kimi-coding.");
  }

  if (!inflightRefresh) {
    inflightRefresh = Promise.resolve().then(() => {
      throw kimiCliSetupError("KimiCLI token is near expiry. Refresh KimiCLI login, then retry kimi-coding.");
    }).finally(() => {
      inflightRefresh = null;
    });
  }

  await inflightRefresh;
  return readKimiCliCredentials().accessToken;
}
