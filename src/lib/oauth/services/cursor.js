import crypto from "crypto";
import { CURSOR_CONFIG } from "../constants/oauth.js";

const REFRESH_TIMEOUT_MS = 15000;
const REFRESH_ATTEMPTS = 3;
const REFRESH_RETRY_BASE_MS = 300;
const EXPIRY_SKEW_MS = 5 * 60 * 1000;
const FALLBACK_TTL_MS = 60 * 60 * 1000;
const CURSOR_USER_AGENT = "Cursor/3.12.29";

function decodeJwtPayload(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function tokenExpiresAt(token) {
  const payload = decodeJwtPayload(token);
  if (typeof payload?.exp === "number") {
    return payload.exp * 1000 - EXPIRY_SKEW_MS;
  }
  return Date.now() + FALLBACK_TTL_MS;
}

function retryDelay(attempt) {
  const exponential = REFRESH_RETRY_BASE_MS * 2 ** attempt;
  return Math.floor(exponential * (0.8 + Math.random() * 0.4));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CursorService {
  constructor() {
    this.config = CURSOR_CONFIG;
  }

  getAuthorizationData(mode = "login") {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const uuid = crypto.randomUUID();
    const query = new URLSearchParams({
      challenge,
      uuid,
      mode,
      supportsSelectedTeamLogin: "true",
    });
    return {
      authUrl: `${this.config.loginUrl}?${query.toString()}`,
      uuid,
      verifier,
      expiresIn: 300,
    };
  }

  async pollToken(uuid, verifier, signal) {
    if (!uuid || !verifier) throw new Error("Cursor OAuth session is incomplete");
    const query = new URLSearchParams({ uuid, verifier });
    const response = await fetch(`${this.config.pollUrl}?${query.toString()}`, {
      headers: {
        Accept: "application/json",
        "User-Agent": CURSOR_USER_AGENT,
        "x-cursor-client-type": this.config.clientType,
        "x-ghost-mode": "implicit-false",
        "x-new-onboarding-completed": "false",
        traceparent: `00-${crypto.randomBytes(16).toString("hex")}-${crypto.randomBytes(8).toString("hex")}-01`,
      },
      signal,
    });
    if (response.status === 404) {
      return { success: false, pending: true, error: "authorization_pending" };
    }
    if (!response.ok) {
      throw new Error(`Cursor OAuth polling failed with HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data.accessToken || !data.refreshToken) {
      throw new Error("Cursor OAuth response was missing tokens");
    }
    return { success: true, tokens: data };
  }

  async refreshToken(refreshToken) {
    if (!refreshToken || typeof refreshToken !== "string") {
      throw new Error("Cursor refresh token is required");
    }
    let lastError;
    for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(this.config.refreshUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${refreshToken}`,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
        });
        if (response.ok) {
          const data = await response.json();
          if (!data.accessToken) {
            throw new Error("Cursor refresh response was missing an access token");
          }
          return this.mapTokens(data.accessToken, data.refreshToken || refreshToken);
        }
        if (response.status !== 429 && response.status < 500) {
          const error = new Error(`Cursor token refresh failed with HTTP ${response.status}`);
          error.retryable = false;
          throw error;
        }
        lastError = new Error(`Cursor token refresh failed with HTTP ${response.status}`);
      } catch (error) {
        if (error.retryable === false) throw error;
        lastError = error;
      }
      if (attempt < REFRESH_ATTEMPTS - 1) await sleep(retryDelay(attempt));
    }
    throw lastError || new Error("Cursor token refresh failed");
  }

  mapTokens(accessToken, refreshToken, machineId = null, authMethod = "oauth") {
    const expiresAt = tokenExpiresAt(accessToken);
    const userInfo = this.extractUserInfo(accessToken);
    return {
      accessToken,
      refreshToken,
      ...(machineId ? { machineId } : {}),
      expiresAt: new Date(expiresAt).toISOString(),
      expiresIn: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
      email: userInfo?.email || null,
      providerSpecificData: {
        authMethod,
        ...(machineId ? { machineId } : {}),
        ...(userInfo?.userId ? { userId: userInfo.userId } : {}),
      },
    };
  }

  async validateImportToken(accessToken, machineId) {
    if (!accessToken || typeof accessToken !== "string") {
      throw new Error("Access token is required");
    }
    if (!machineId || typeof machineId !== "string") {
      throw new Error("Machine ID is required");
    }
    if (accessToken.length < 50) {
      throw new Error("Invalid token format. Token appears too short.");
    }
    const uuidRegex = /^[a-f0-9-]{32,}$/i;
    if (!uuidRegex.test(machineId.replace(/-/g, ""))) {
      throw new Error("Invalid machine ID format. Expected UUID format.");
    }
    return this.mapTokens(accessToken, null, machineId, "imported");
  }

  extractUserInfo(accessToken) {
    const payload = decodeJwtPayload(accessToken);
    if (!payload) return null;
    const email = typeof payload.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
      ? payload.email
      : null;
    return {
      email,
      userId: payload.sub || payload.user_id || null,
    };
  }

  getTokenStorageInstructions() {
    return {
      title: "How to import your existing Cursor session",
      steps: [
        "Open Cursor IDE and make sure you're logged in",
        `Linux: ${this.config.tokenStoragePaths.linux}`,
        `macOS: ${this.config.tokenStoragePaths.macos}`,
        `Windows: ${this.config.tokenStoragePaths.windows}`,
        "Read cursorAuth/accessToken and storage.serviceMachineId from itemTable",
      ],
    };
  }
}
