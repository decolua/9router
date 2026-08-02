import { QODER_CONFIG } from "../constants/oauth.js";

const qoder = {
  config: QODER_CONFIG,
  flowType: "device_code",
  // Qoder uses a custom device flow: PKCE + nonce + machine_id are generated
  // locally, the user lands on qoder.com/device/selectAccounts in the
  // browser, and we poll openapi.qoder.sh until a `dt-...` token appears.
  requestDeviceCode: async (config) => {
    const { QoderService } = await import("@/lib/oauth/services/qoder");
    const flow = new QoderService().initiateDeviceFlow();
    // Match the device_code shape the rest of the OAuthModal expects
    // (device_code, user_code, verification_uri[_complete], interval).
    // The poll endpoint identifies us by nonce+verifier, not by a
    // server-issued device_code, so we plumb our own values through:
    //   device_code   = nonce  (modal forwards as deviceCode on poll)
    //   codeVerifier  = our PKCE verifier (route forwards as codeVerifier)
    return {
      device_code: flow.nonce,
      user_code: flow.nonce.slice(0, 8).toUpperCase(),
      verification_uri: config.loginUrl,
      verification_uri_complete: flow.verificationUriComplete,
      expires_in: 300,
      interval: 2,
      codeVerifier: flow.codeVerifier,
      _qoderNonce: flow.nonce,
      _qoderMachineId: flow.machineId,
    };
  },
  pollToken: async (config, deviceCode, codeVerifier, extraData) => {
    const { QoderService } = await import("@/lib/oauth/services/qoder");
    const svc = new QoderService();
    const nonce = deviceCode || extraData?._qoderNonce;
    const verifier = codeVerifier || extraData?._qoderVerifier;
    if (!nonce || !verifier) {
      return {
        ok: false,
        data: { error: "invalid_request", error_description: "Missing nonce/verifier" },
      };
    }
    let result;
    try {
      result = await svc.pollDeviceToken({ nonce, codeVerifier: verifier });
    } catch (err) {
      return {
        ok: false,
        data: { error: "poll_failed", error_description: err.message },
      };
    }
    if (result.status === "pending") {
      return { ok: false, data: { error: "authorization_pending" } };
    }
    // Best-effort profile lookup so we have a name/email to display.
    const userInfo = await svc.fetchUserInfo(result.accessToken);
    // expireTime is a Unix-ms timestamp from QoderService.parseExpiry,
    // which already falls back to "now + 30 days" when the upstream
    // omits expiry. Floor to a sane minimum (1 day) so a stale or
    // skewed upstream timestamp doesn't truncate the stored token below
    // something useful.
    const minSeconds = 24 * 60 * 60;
    const remainingSeconds = Math.floor((result.expireTime - Date.now()) / 1000);
    const expiresIn = Math.max(minSeconds, remainingSeconds);
    return {
      ok: true,
      data: {
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
        expires_in: expiresIn,
        _qoderUserId: result.userId,
        _qoderMachineId: extraData?._qoderMachineId || "",
        _qoderName: userInfo.name,
        _qoderEmail: userInfo.email,
        _qoderOrganizationId: userInfo.organizationId,
      },
    };
  },
  mapTokens: (tokens) => {
    const rawEmail = (tokens._qoderEmail || "").trim();
    const displayName = (tokens._qoderName || "").trim() || null;
    const userId = tokens._qoderUserId || "";
    // Dedup in createProviderConnection requires a non-empty email. When
    // fetchUserInfo silently fails (returns ""), fall back to a stable
    // synthetic identifier derived from userId so re-logins update the
    // existing row instead of accumulating "Account N" duplicates.
    const email = rawEmail || (userId ? `qoder-user-${userId}` : null);
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || null,
      expiresIn: tokens.expires_in,
      email,
      displayName,
      providerSpecificData: {
        authMethod: "device",
        userId,
        machineId: tokens._qoderMachineId || "",
        organizationId: tokens._qoderOrganizationId || "",
      },
    };
  },
};

export default qoder;
