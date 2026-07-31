import {
  resolveProfile,
} from "../../../../open-sse/protocol/qoder/index.js";
import { proxyAwareFetch } from "../../../../open-sse/utils/proxyFetch.js";
import crypto from "crypto";

async function resolveMachineToken(machineId) {
  // SecurityGuard UMID derivation is optional and platform-dependent; when it
  // is unavailable the raw UUID is used for both machine fields.
  return machineId;
}

/**
 * Qoder OAuth Service — device-token flow + openapi deviceToken refresh.
 * URLs from protocol Profile (intl | cn-work). Protocol chat stays separate.
 */

const FETCH_TIMEOUT_MS = 15_000;

function base64Url(buf) {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function fetchWithTimeout(fetchImpl, url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal }, null);
  } finally {
    clearTimeout(timer);
  }
}

export class QoderService {
  /**
   * @param {{ profile?: string | object | null, machineTokenResolver?: (machineId: string) => Promise<string>, fetchImpl?: typeof proxyAwareFetch }} [options]
   */
  constructor(options = {}) {
    this.profile = resolveProfile(options.profile ?? null);
    this.machineTokenResolver = options.machineTokenResolver || resolveMachineToken;
    this.fetchImpl = options.fetchImpl || proxyAwareFetch;
  }

  generatePkcePair() {
    // Match QoderWork CN desktop (main.js generatePKCE$1): unreserved
    // charset, length 43–128, S256 challenge as base64url.
    const charset =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    const len = 43 + Math.floor(Math.random() * 86);
    const bytes = crypto.randomBytes(len);
    let verifier = "";
    for (let i = 0; i < len; i++) verifier += charset[bytes[i] % charset.length];
    const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
    return { verifier, challenge };
  }

  /**
   * Initiate the device flow with a raw UUID machine id and a separately
   * derived SecurityGuard machine token. The token falls back to the UUID
   * when the optional runtime-info integration is unavailable.
   */
  async initiateDeviceFlow() {
    const { verifier, challenge } = this.generatePkcePair();
    const nonce = crypto.randomUUID();
    const machineId = crypto.randomUUID();
    const machineToken = (await this.machineTokenResolver(machineId)) || machineId;

    // Param order/names match desktop startDeviceFlow (selectAccounts).
    const params = new URLSearchParams();
    params.set("challenge", challenge);
    params.set("challenge_method", "S256");
    params.set("nonce", nonce);
    params.set("machine_id", machineId);

    // CN rejects bare login URL ("参数无效") without client_id + redirect_uri.
    const clientId = this.profile.deviceClientId || null;
    const redirectUri = this.profile.deviceRedirectUri || null;
    if (clientId) params.set("client_id", clientId);
    if (redirectUri) params.set("redirect_uri", redirectUri);

    if (this.profile.id === "cn-work" && (!clientId || !redirectUri)) {
      throw new Error(
        "qoder cn-work device flow requires deviceClientId and deviceRedirectUri on profile",
      );
    }

    return {
      verificationUriComplete: `${this.profile.loginUrl}?${params.toString()}`,
      codeVerifier: verifier,
      nonce,
      machineId,
      machineToken,
    };
  }

  /**
   * @returns {Promise<{ status: "pending" } | { status: "ok", accessToken: string, refreshToken: string, userId: string, expireTime: number, rawResponse: object }>}
   */
  async pollDeviceToken({ nonce, codeVerifier }) {
    if (!nonce || !codeVerifier) {
      throw new Error("pollDeviceToken: missing nonce or code verifier");
    }
    const url = `${this.profile.deviceTokenUrl}?nonce=${encodeURIComponent(nonce)}&verifier=${encodeURIComponent(codeVerifier)}&challenge_method=S256`;

    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Go-http-client/2.0",
      },
    });

    if (response.status === 202 || response.status === 404) {
      return { status: "pending" };
    }

    const text = await response.text();

    if (!response.ok) {
      let message = `Qoder device token poll failed: HTTP ${response.status}`;
      try {
        const body = JSON.parse(text);
        if (body.message) message = `Qoder device token poll failed: ${body.message}`;
      } catch {
        /* keep */
      }
      throw new Error(message);
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch (err) {
      throw new Error(`Qoder device token poll: invalid JSON response (${err.message})`);
    }

    if (!body.token) {
      throw new Error("Qoder device token poll returned 200 but no token");
    }

    const expireMs = QoderService.parseExpiry(body.expires_at, body.expires_in);

    return {
      status: "ok",
      accessToken: body.token,
      refreshToken: body.refresh_token || "",
      userId: body.user_id || "",
      expireTime: expireMs,
      rawResponse: body,
    };
  }

  async fetchUserInfo(accessToken) {
    try {
      const response = await fetchWithTimeout(this.fetchImpl, this.profile.userInfoUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "User-Agent": "Go-http-client/2.0",
        },
      });
      if (!response.ok) return { name: "", email: "" };
      const body = await response.json();
      return {
        name: (body.name || body.username || "").trim(),
        email: (body.email || "").trim(),
        organizationId: (body.organization_id || "").trim(),
      };
    } catch {
      return { name: "", email: "" };
    }
  }

  /**
   * POST openapi /api/v1/deviceToken/refresh
   * Response: device_token|token + refresh_token (CN desktop).
   *
   * @param {string} refreshToken
   * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, expireTime: number }>}
   */
  async refreshDeviceToken(refreshToken) {
    if (!refreshToken) {
      throw new Error("refreshDeviceToken: missing refresh token");
    }
    const url = this.profile.refreshTokenUrl;
    if (!url) {
      throw new Error("refreshDeviceToken: profile has no refreshTokenUrl");
    }

    const response = await fetchWithTimeout(this.fetchImpl, url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Go-http-client/2.0",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const text = await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }

    if (!response.ok) {
      const msg =
        (body && (body.message || body.error_description || body.error)) ||
        `HTTP ${response.status}`;
      const err = new Error(`Qoder device token refresh failed: ${msg}`);
      err.status = response.status;
      err.body = body;
      throw err;
    }

    const access =
      (body && (body.device_token || body.token || body.access_token)) || null;
    const nextRefresh =
      (body && (body.refresh_token || body.refreshToken)) || refreshToken;
    if (!access || typeof access !== "string") {
      throw new Error("Qoder device token refresh: missing device_token/token");
    }

    const expireMs = QoderService.parseExpiry(
      body?.expires_at || body?.expiresAt,
      body?.expires_in ?? body?.expiresIn,
    );
    const expiresIn = Math.max(60, Math.floor((expireMs - Date.now()) / 1000));

    return {
      accessToken: access,
      refreshToken: nextRefresh,
      expiresIn,
      expireTime: expireMs,
      rawResponse: body,
    };
  }

  static parseExpiry(expiresAt, expiresInSeconds) {
    if (typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0) {
      return expiresAt;
    }
    const trimmed = typeof expiresAt === "string" ? expiresAt.trim() : "";
    if (trimmed) {
      if (/^\d+$/.test(trimmed)) {
        const ms = Number.parseInt(trimmed, 10);
        if (Number.isFinite(ms) && ms > 0) return ms;
      }
      const parsed = Date.parse(trimmed);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (
      typeof expiresInSeconds === "number" &&
      Number.isFinite(expiresInSeconds) &&
      expiresInSeconds >= 0
    ) {
      return Date.now() + expiresInSeconds * 1000;
    }
    return Date.now() + 30 * 24 * 60 * 60 * 1000;
  }
}

export { resolveProfile };
