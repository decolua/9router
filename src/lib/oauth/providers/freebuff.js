import crypto from "node:crypto";
import { FREEBUFF_CONFIG } from "../constants/oauth.js";

const LOGIN_HOST = "https://freebuff.com";

const freebuff = {
  config: FREEBUFF_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const fingerprintId = crypto.randomUUID();
    const baseUrl = (config.baseUrl || LOGIN_HOST).replace(/\/$/, "");
    const response = await fetch(`${baseUrl}${config.loginCodePath || "/api/auth/cli/code"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": "codebuff-cli/0.0.138" },
      body: JSON.stringify({ fingerprintId }),
    });
    if (!response.ok) throw new Error(`Freebuff login code request failed: ${await response.text()}`);
    const data = await response.json();
    const loginUrl = typeof data.loginUrl === "string" ? data.loginUrl : "";
    const expiresAt = Number(data.expiresAt) || 0;
    const timeoutSec = Math.max(60, Math.floor((config.oauthTimeoutMs || 300000) / 1000));
    const serverMs = Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt - Date.now() : timeoutSec * 1000;
    return {
      device_code: JSON.stringify({ fingerprintId: data.fingerprintId || fingerprintId, fingerprintHash: data.fingerprintHash, expiresAt }),
      user_code: loginUrl.match(/auth_code=([^&]+)/)?.[1] || "",
      verification_uri: loginUrl,
      verification_uri_complete: loginUrl,
      expires_in: Math.max(60, Math.min(Math.floor(serverMs / 1000), timeoutSec)),
      interval: 5,
    };
  },
  pollToken: async (config, deviceCode) => {
    let parsed = {};
    try { parsed = JSON.parse(deviceCode) || {}; } catch { parsed = {}; }
    const { fingerprintId, fingerprintHash, expiresAt } = parsed;
    if (!fingerprintId || !fingerprintHash || !expiresAt) return { ok: true, data: { error: "authorization_pending" } };
    const baseUrl = (config.baseUrl || LOGIN_HOST).replace(/\/$/, "");
    const query = new URLSearchParams({ fingerprintId, fingerprintHash, expiresAt: String(expiresAt) });
    const response = await fetch(`${baseUrl}${config.loginStatusPath || "/api/auth/cli/status"}?${query}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "codebuff-cli/0.0.138" },
    });
    const data = await response.json().catch(() => ({}));
    if (data?.user?.authToken) return { ok: true, data: { access_token: data.user.authToken, ...data.user } };
    return { ok: true, data: { error: "authorization_pending" } };
  },
  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: null,
    email: tokens.email || undefined,
    displayName: tokens.name || undefined,
    providerSpecificData: { authMethod: "device_code", fingerprintId: tokens.fingerprintId || null, userId: tokens.id || null },
  }),
};

export default freebuff;
