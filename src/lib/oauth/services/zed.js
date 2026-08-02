/**
 * Zed Hosted AI credential helpers for CLI/keyring import.
 * RSA native-app OAuth lives in open-sse/shared/zedAuth.js + providers/zed.js;
 * this service covers the alternate "paste/import user_id + access_token" path.
 */
import {
  ZED_HOSTED_CONFIG,
} from "../constants/oauth.js";
import {
  fetchZedAuthenticatedUser,
  fetchZedLlmToken,
  resolveZedOrganizationId,
} from "open-sse/shared/zedAuth.js";

export class ZedService {
  constructor() {
    this.config = ZED_HOSTED_CONFIG;
  }

  /**
   * Validate import credentials against cloud.zed.dev.
   * Returns the long-lived user access token shape expected by zedAuth / ZedExecutor
   * (LLM tokens are minted on demand by zedLlmFetch — do NOT store them as accessToken).
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
    const trimmedToken = accessToken.trim();
    if (!/^\d+$/.test(trimmedUserId) && !/^[a-zA-Z0-9_-]+$/.test(trimmedUserId)) {
      throw new Error("Invalid user ID format");
    }
    if (trimmedToken.length < 16) {
      throw new Error("Invalid access token format. Token appears too short.");
    }

    const credentials = {
      accessToken: trimmedToken,
      providerSpecificData: { userId: trimmedUserId },
    };

    let userMe;
    try {
      userMe = await fetchZedAuthenticatedUser(credentials, { config: this.config });
    } catch (firstErr) {
      const msg = String(firstErr?.message || firstErr);
      if ((msg.includes("401") || firstErr?.status === 401) && !trimmedToken.trimStart().startsWith("{")) {
        throw new Error(
          `${msg}. For Zed keyring v2 credentials, paste the full JSON secret ` +
            `(starts with {"version":2,...}), not only the inner token field. ` +
            `Click Retry to auto-detect again.`,
        );
      }
      throw firstErr;
    }

    const organizationId = resolveZedOrganizationId(credentials, userMe);
    // Probe LLM mint once so bad org/billing fails at import time, not mid-chat.
    await fetchZedLlmToken(
      { ...credentials, providerSpecificData: { ...credentials.providerSpecificData, organizationId } },
      { config: this.config, organizationId },
    );

    return {
      userId: trimmedUserId,
      accessToken: trimmedToken,
      organizationId,
      email: userMe?.email || userMe?.user?.email || userMe?.github_login || userMe?.user?.github_login || null,
      name: userMe?.name || userMe?.display_name || userMe?.user?.name || null,
      userMe,
    };
  }

  getTokenStorageInstructions() {
    return {
      linux: "Zed credentials are typically in the system keyring (libsecret) or ~/.local/share/zed/ development credentials when ZED_DEVELOPMENT_USE_KEYCHAIN is set.",
      macos: "Zed credentials are stored in the macOS Keychain (search for zed).",
      windows: "Zed credentials are stored via the Windows Credential Manager.",
      manual:
        "From a Zed session, copy your user_id and access_token (format used as Authorization: \"{user_id} {access_token}\"). Prefer the dashboard Connect flow (RSA native-app sign-in) when possible.",
    };
  }
}
