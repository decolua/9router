/**
 * QoderExecutor — thin adapter over open-sse/protocol/qoder.
 *
 * Shared for providers: qoder (intl) and qoderwork-cn (CN Profile).
 * Identity refresh: openapi deviceToken/refresh via tokenRefresh handlers.
 */

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { chat as qoderChat } from "../protocol/qoder/index.js";
import { refreshQoderDeviceToken } from "../services/tokenRefresh/providers.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";

export class QoderExecutor extends BaseExecutor {
  constructor(providerId = "qoder", config = null) {
    super(providerId, config || PROVIDERS[providerId] || PROVIDERS.qoder);
  }

  /** @returns {string} profile id for protocol.resolveProfile */
  getProtocolProfile() {
    return this.config.protocolProfile;
  }

  buildUrl() {
    return this.config?.baseUrl || "";
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const timeoutMs = this.config?.timeoutMs || null;
    return qoderChat({
      model,
      body,
      credentials,
      signal,
      log,
      proxyOptions,
      timeoutMs,
      profile: this.getProtocolProfile(),
    });
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials(this.provider, credentials);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials?.refreshToken) return null;
    return refreshQoderDeviceToken(
      credentials.refreshToken,
      this.getProtocolProfile(),
      log,
    );
  }
}
