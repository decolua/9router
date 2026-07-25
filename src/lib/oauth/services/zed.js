import { ZED_CONFIG } from "../constants/oauth.js";

/**
 * Zed Hosted AI OAuth Service
 * Import credentials from Zed Editor (`user_id` + `access_token`), then mint an LLM token.
 *
 * Credential format (Zed keychain / development_credentials):
 *   Authorization: "{userId} {accessToken}"
 *
 * LLM calls use: Authorization: Bearer {llm_token}
 */
export class ZedService {
  constructor() {
    this.config = ZED_CONFIG;
  }

  get baseUrl() {
    return (this.config.apiEndpoint || "https://cloud.zed.dev").replace(/\/$/, "");
  }

  userAuthHeader(userId, accessToken) {
    return `${userId} ${accessToken}`;
  }

  /**
   * Probe account with Zed user credentials.
   */
  async fetchUserMe(userId, accessToken) {
    const res = await fetch(`${this.baseUrl}${this.config.usersMePath || "/client/users/me"}`, {
      method: "GET",
      headers: {
        Authorization: this.userAuthHeader(userId, accessToken),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Zed auth failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Zed /client/users/me returned invalid JSON");
    }
  }

  /**
   * Mint short-lived LLM bearer token.
   */
  async fetchLlmToken(userId, accessToken, organizationId) {
    const body = organizationId ? { organization_id: organizationId } : {};
    const res = await fetch(`${this.baseUrl}${this.config.llmTokensPath || "/client/llm_tokens"}`, {
      method: "POST",
      headers: {
        Authorization: this.userAuthHeader(userId, accessToken),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Zed LLM token failed (${res.status}): ${text.slice(0, 200) || res.statusText}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Zed /client/llm_tokens returned invalid JSON");
    }
    // Response may be { token: "..." } or { token: { "0": "..." } } (CBOR-ish unwrap from RE docs)
    const raw = data?.token;
    const token =
      typeof raw === "string"
        ? raw
        : raw && typeof raw === "object"
          ? raw["0"] || raw.token || Object.values(raw)[0]
          : null;
    if (!token || typeof token !== "string") {
      throw new Error("Zed LLM token response missing token");
    }
    return token;
  }

  extractOrganizationId(userMe) {
    const def = userMe?.default_organization_id;
    if (typeof def === "string" && def.length > 1) return def;
    // Older responses wrapped ids as { "0": "org_…" }
    if (def && typeof def === "object") {
      const wrapped = def["0"] || def.id;
      if (typeof wrapped === "string" && wrapped.length > 1) return wrapped;
    }
    const orgs = userMe?.organizations;
    if (Array.isArray(orgs) && orgs[0]) {
      const id = orgs[0].id;
      if (typeof id === "string" && id.length > 1) return id;
      if (id && typeof id === "object") {
        const wrapped = id["0"];
        if (typeof wrapped === "string" && wrapped.length > 1) return wrapped;
      }
    }
    return null;
  }

  extractEmail(userMe) {
    return (
      userMe?.user?.email ||
      userMe?.user?.github_login ||
      userMe?.email ||
      userMe?.github_login ||
      null
    );
  }

  /**
   * Validate import credentials and mint LLM token.
   * @param {string} userId
   * @param {string} accessToken - Zed user access token (plain, or keyring JSON v2 blob)
   */
  async validateImportToken(userId, accessToken) {
    if (!userId || typeof userId !== "string") {
      throw new Error("User ID is required");
    }
    if (!accessToken || typeof accessToken !== "string") {
      throw new Error("Access token is required");
    }

    const trimmedUserId = userId.trim();
    let trimmedToken = accessToken.trim();
    if (!/^\d+$/.test(trimmedUserId) && !/^[a-zA-Z0-9_-]+$/.test(trimmedUserId)) {
      throw new Error("Invalid user ID format");
    }
    if (trimmedToken.length < 16) {
      throw new Error("Invalid access token format. Token appears too short.");
    }

    // If the user pasted only the inner v2 `.token`, try wrapping is not possible
    // without id — but if they pasted the full JSON blob, keep it as-is.
    // Also accept legacy plain tokens.

    let userMe;
    try {
      userMe = await this.fetchUserMe(trimmedUserId, trimmedToken);
    } catch (firstErr) {
      // Compatibility: older auto-import sent only JSON.token; rebuild is impossible
      // without the client_token id. Re-throw with a clearer hint.
      const msg = String(firstErr?.message || firstErr);
      if (msg.includes("401") && !trimmedToken.trimStart().startsWith("{")) {
        throw new Error(
          `${msg}. For Zed keyring v2 credentials, paste the full JSON secret ` +
            `(starts with {"version":2,...}), not only the inner token field. ` +
            `Click Retry to auto-detect again.`,
        );
      }
      throw firstErr;
    }

    const organizationId = this.extractOrganizationId(userMe);
    const llmToken = await this.fetchLlmToken(trimmedUserId, trimmedToken, organizationId);

    return {
      llmToken,
      userId: trimmedUserId,
      accessToken: trimmedToken,
      organizationId,
      email: this.extractEmail(userMe),
      expiresIn: 3600,
      userMe,
    };
  }

  /**
   * Refresh LLM bearer token using stored Zed user credentials.
   */
  async refreshLlmToken(userId, zedAccessToken, organizationId) {
    const llmToken = await this.fetchLlmToken(userId, zedAccessToken, organizationId);
    return {
      accessToken: llmToken,
      expiresIn: 3600,
      providerSpecificData: {
        llmToken,
        lastLlmTokenAt: new Date().toISOString(),
      },
    };
  }

  getTokenStorageInstructions() {
    return {
      linux: "Zed credentials are typically in the system keyring (libsecret) or ~/.local/share/zed/ development credentials when ZED_DEVELOPMENT_USE_KEYCHAIN is set.",
      macos: "Zed credentials are stored in the macOS Keychain (search for zed).",
      windows: "Zed credentials are stored via the Windows Credential Manager.",
      manual:
        "From a Zed session, copy your user_id and access_token (format used as Authorization: \"{user_id} {access_token}\").",
    };
  }
}
