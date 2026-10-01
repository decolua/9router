// Kimchi browser-login service.
//
// Ports Kimchi CLI's authenticateViaBrowser (src/cli-auth/index.ts) onto
// 9Router's shared startLocalServer util (same one xai/antigravity use).
// Simpler than those: the token arrives directly on the callback query
// string — no authorization-code exchange, no PKCE.
//
// In-flight logins are held in `sessions` keyed by state. The OAuthModal
// device_code flow starts one via requestDeviceCode(); pollToken() peeks
// at the resolved token; the generic [provider]/[action] route calls
// createProviderConnection with the real token.
import { randomBytes } from "node:crypto";
import { startLocalServer } from "../utils/server.js";
import { KIMCHI_CONFIG } from "../constants/oauth.js";

const sessions = new Map(); // state -> { result, close, timeout, done, resolved }
const SESSION_TTL_MS = 5 * 60 * 1000;

export function buildKimchiAuthUrl(callbackUrl, state) {
  const params = new URLSearchParams({ callback: callbackUrl, state });
  return `${KIMCHI_CONFIG.webAppUrl}/cli-auth?${params.toString()}`;
}

export function generateState() {
  return randomBytes(32).toString("hex");
}

// Returns the resolved { token } if the session for `state` has completed,
// or null if it is still pending / unknown.
export function getResolvedSession(state) {
  const s = sessions.get(state);
  if (!s || !s.done || !s.resolved) return null;
  return s.resolved;
}

export class KimchiService {
  async startLogin() {
    const state = generateState();
    let resolveResult;
    const result = new Promise((resolve) => { resolveResult = resolve; });

    const { port, close } = await startLocalServer((params) => {
      this._handleCallback(params, state)
        .then(resolveResult)
        .catch((err) => resolveResult({ error: err.message }));
    });

    const timeout = setTimeout(() => {
      resolveResult({ error: "Browser login timed out — please try again" });
      close();
    }, KIMCHI_CONFIG.callbackTimeoutMs);

    sessions.set(state, { result, close, timeout, done: false, resolved: null });

    // Stash the resolved value so pollToken() can retrieve the real token,
    // close the loopback server, and reap the session after a TTL so the
    // Map can't grow unbounded across many logins.
    result.then((r) => {
      const s = sessions.get(state);
      if (!s) return;
      s.done = true;
      s.resolved = r;
      clearTimeout(s.timeout);
      try { s.close(); } catch { /* already closed */ }
      setTimeout(() => sessions.delete(state), SESSION_TTL_MS).unref?.();
    });

    const callbackUrl = `http://127.0.0.1:${port}${KIMCHI_CONFIG.callbackPath}`;
    const authUrl = buildKimchiAuthUrl(callbackUrl, state);
    return { authUrl, port, state, result, close };
  }

  async _handleCallback(params, expectedState) {
    if (params.error) {
      throw new Error(params.error_description || params.error);
    }
    const candidate = params.state;
    if (!candidate || candidate !== expectedState) {
      throw new Error("This request isn't valid. Please restart the Kimchi login flow.");
    }
    const token = params.token;
    if (!token) {
      throw new Error("No token was returned by the Kimchi authentication server");
    }
    const check = await this.validateToken(token);
    if (!check.valid) {
      throw new Error(check.error || "Kimchi token validation failed");
    }
    return { token };
  }

  async fetchProfile(token) {
    try {
      const res = await fetch(KIMCHI_CONFIG.meUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return {};
      const j = await res.json();
      return { displayName: j.name, email: j.email, username: j.username };
    } catch {
      return {};
    }
  }

  // Validate a token against Kimchi's supported-providers endpoint.
  // 200 → valid; 401/403 → invalid; anything else (incl. network/timeout)
  // → fail-open valid so a flaky validation never blocks a good login.
  async validateToken(token) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let status = 0;
    try {
      const res = await fetch(KIMCHI_CONFIG.validationUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      status = res.status;
    } catch {
      // Network error / abort → fail-open
      return { valid: true };
    } finally {
      clearTimeout(timer);
    }
    if (status === 200) return { valid: true };
    if (status === 401) return { valid: false, error: "Kimchi token invalid or expired" };
    if (status === 403) return { valid: false, error: "Kimchi token lacks required scope" };
    return { valid: true };
  }
}
