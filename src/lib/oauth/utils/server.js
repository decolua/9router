import http from "http";
import { URL } from "url";
import { CODEX_CONFIG, TRAE_CONFIG, WINDSURF_CONFIG, ZED_HOSTED_CONFIG } from "../constants/oauth.js";
import { sanitizeOAuthError } from "open-sse/utils/oauthError.js";

// Loopback origin guard for local callback proxies.
// Legit OAuth redirects are top-level navigations (no `Origin` header); a cross-site
// page issuing `fetch(..., {mode:"no-cors"})` to scan + hit 127.0.0.1 always sends
// `Origin: https://attacker`. Reject any non-loopback Origin to block login-CSRF.
function isLoopbackOrigin(origin) {
  if (!origin) return true; // navigation redirect — allow
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}


/**
 * Start a local HTTP server to receive OAuth callback
 * @param {Function} onCallback - Called with query params when callback received
 * @param {number} fixedPort - Optional fixed port number (default: random)
 * @returns {Promise<{server: http.Server, port: number, close: Function}>}
 */
export function startLocalServer(onCallback, fixedPort = null) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);

      if (url.pathname === "/callback" || url.pathname === "/auth/callback") {
        const params = Object.fromEntries(url.searchParams);

        // Send success response to browser with auto-close attempt
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Successful</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .success { color: #22c55e; font-size: 3rem; }
    h1 { margin: 1rem 0; }
    p { color: #666; }
    #countdown { font-weight: bold; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success">&#10003;</div>
    <h1>Authentication Successful</h1>
    <p id="message">Closing in <span id="countdown">3</span> seconds...</p>
  </div>
  <script>
    let count = 3;
    const countdown = document.getElementById("countdown");
    const message = document.getElementById("message");
    const timer = setInterval(() => {
      count--;
      countdown.textContent = count;
      if (count <= 0) {
        clearInterval(timer);
        window.close();
        setTimeout(() => {
          message.textContent = "Please close this tab manually.";
        }, 500);
      }
    }, 1000);
  </script>
</body>
</html>`);

        // Call callback with params
        onCallback(params);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    // Listen on fixed port or find available port
    const portToUse = fixedPort || 0;
    server.listen(portToUse, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        close: () => server.close(),
      });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE" && fixedPort) {
        reject(new Error(`Port ${fixedPort} is already in use. Please close other applications using this port.`));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Wait for callback with timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<Object>} - Callback params
 */
export function waitForCallback(timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Authentication timeout"));
      }
    }, timeoutMs);

    const onCallback = (params) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(params);
      }
    };

    // Return the callback function
    resolve.__onCallback = onCallback;
  });
}

// Singleton proxy server for Codex OAuth callback on fixed port
let codexProxyServer = null;
let codexProxyTimeout = null;
let codexProxyClosing = null;
let codexProxyStarting = null;
let codexProxyAppPort = null;

const CODEX_PROXY_TIMEOUT_MS = 300000; // 5 minutes
const CODEX_PORT = CODEX_CONFIG.fixedPort;
const PROXY_CLOSE_GRACE_MS = 30000;
const OAUTH_SESSION_TTL_MS = 300000;
const OAUTH_SESSION_MAX_ENTRIES = 128;
const DEVICE_FLOW_TTL_MS = 15 * 60 * 1000;
const DEVICE_FLOW_MAX_ENTRIES = 128;

function closeProxyServer(server) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, PROXY_CLOSE_GRACE_MS);

    try {
      server.close(finish);
    } catch {
      finish();
    }
  });
}

// Pending exchange sessions keyed by state — used by server-side exchange mode
const pendingExchanges = new Map();
const authorizationFlows = new Map();
const deviceAuthorizationFlows = new Map();

function pruneExpiredSessions(sessions, now = Date.now()) {
  for (const [state, session] of sessions) {
    if (now - session.createdAt > OAUTH_SESSION_TTL_MS) sessions.delete(state);
  }
}

function setBoundedSession(sessions, state, session) {
  pruneExpiredSessions(sessions);
  if (sessions.has(state) || sessions.size >= OAUTH_SESSION_MAX_ENTRIES) return false;
  sessions.set(state, { ...session, identity: Symbol("oauth-flow") });
  return true;
}

function getLiveSession(sessions, state) {
  pruneExpiredSessions(sessions);
  return state ? sessions.get(state) || null : null;
}

function claimLiveSession(sessions, state) {
  const session = getLiveSession(sessions, state);
  if (!session || session.status !== "pending") return null;
  session.status = "exchanging";
  return session;
}

function isCurrentSession(sessions, state, identity) {
  const session = getLiveSession(sessions, state);
  return Boolean(session && session.identity === identity && session.status === "exchanging");
}

function clearSession(sessions, state, identity = null) {
  const session = sessions.get(state);
  if (!session || (identity && session.identity !== identity)) return false;
  sessions.delete(state);
  return true;
}

function authorizationFlowKey(kind, provider, state) {
  return `${kind}:${provider}:${state}`;
}

export function registerAuthorizationFlow({ kind = "oauth", provider, state, ...context }) {
  if (!provider || !state || !context.codeVerifier) return false;
  return setBoundedSession(
    authorizationFlows,
    authorizationFlowKey(kind, provider, state),
    { ...context, provider, state, status: "pending", createdAt: Date.now() },
  );
}

export function claimAuthorizationFlow(kind, provider, state) {
  const session = claimLiveSession(authorizationFlows, authorizationFlowKey(kind, provider, state));
  return session ? { ...session } : null;
}

export function isAuthorizationFlowCurrent(kind, provider, state, identity) {
  return isCurrentSession(authorizationFlows, authorizationFlowKey(kind, provider, state), identity);
}

export function clearAuthorizationFlow(kind, provider, state, identity = null) {
  return clearSession(authorizationFlows, authorizationFlowKey(kind, provider, state), identity);
}

function deviceFlowKey(provider, flowId) {
  return `${provider}:${flowId}`;
}

function pruneExpiredDeviceFlows(now = Date.now()) {
  for (const [key, flow] of deviceAuthorizationFlows) {
    if (flow.expiresAt <= now) deviceAuthorizationFlows.delete(key);
  }
}

function getDeviceFlow(provider, flowId) {
  pruneExpiredDeviceFlows();
  return flowId ? deviceAuthorizationFlows.get(deviceFlowKey(provider, flowId)) || null : null;
}

export function reserveDeviceAuthorizationFlow({ provider, flowId, ...context }) {
  pruneExpiredDeviceFlows();
  const key = deviceFlowKey(provider, flowId);
  if (!provider || !flowId || deviceAuthorizationFlows.has(key) || deviceAuthorizationFlows.size >= DEVICE_FLOW_MAX_ENTRIES) {
    return null;
  }
  const flow = {
    ...context,
    provider,
    flowId,
    identity: Symbol("device-oauth-flow"),
    status: "starting",
    expiresAt: Date.now() + DEVICE_FLOW_TTL_MS,
  };
  deviceAuthorizationFlows.set(key, flow);
  return { ...flow };
}

export function bindDeviceAuthorizationFlow(provider, flowId, identity, context) {
  const flow = getDeviceFlow(provider, flowId);
  if (!flow || flow.identity !== identity || flow.status !== "starting") return false;
  Object.assign(flow, context, { status: "pending" });
  return true;
}

export function claimDeviceAuthorizationFlow(provider, flowId) {
  const flow = getDeviceFlow(provider, flowId);
  if (!flow || flow.status !== "pending") return null;
  flow.status = "polling";
  return { ...flow };
}

export function releaseDeviceAuthorizationFlow(provider, flowId, identity) {
  const flow = getDeviceFlow(provider, flowId);
  if (!flow || flow.identity !== identity || flow.status !== "polling") return false;
  flow.status = "pending";
  return true;
}

export function isDeviceAuthorizationFlowCurrent(provider, flowId, identity) {
  const flow = getDeviceFlow(provider, flowId);
  return Boolean(flow && flow.identity === identity && flow.status === "polling");
}

export function clearDeviceAuthorizationFlow(provider, flowId, identity = null) {
  const key = deviceFlowKey(provider, flowId);
  const flow = deviceAuthorizationFlows.get(key);
  if (!flow || (identity && flow.identity !== identity)) return false;
  deviceAuthorizationFlows.delete(key);
  return true;
}

export function clearDeviceAuthorizationFlows() {
  deviceAuthorizationFlows.clear();
}

function publicSessionStatus(session) {
  if (!session) return null;
  return {
    status: session.status,
    ...(session.connectionId ? { connectionId: session.connectionId } : {}),
    ...(session.email ? { email: session.email } : {}),
    ...(session.error ? { error: sanitizeOAuthError(session.error) } : {}),
  };
}

function hasPendingSessions(sessions) {
  pruneExpiredSessions(sessions);
  return [...sessions.values()].some((session) => ["pending", "exchanging"].includes(session.status));
}

function hasLiveSessions(sessions) {
  pruneExpiredSessions(sessions);
  return sessions.size > 0;
}

function latestPendingSessionDeadline(sessions) {
  pruneExpiredSessions(sessions);
  let deadline = 0;
  for (const session of sessions.values()) {
    if (["pending", "exchanging"].includes(session.status)) {
      deadline = Math.max(deadline, session.createdAt + OAUTH_SESSION_TTL_MS);
    }
  }
  return deadline;
}

function scheduleCodexProxyTimeout() {
  if (codexProxyTimeout) clearTimeout(codexProxyTimeout);
  codexProxyTimeout = null;
  if (!codexProxyServer) return;

  const server = codexProxyServer;
  const deadline = latestPendingSessionDeadline(pendingExchanges) || Date.now() + CODEX_PROXY_TIMEOUT_MS;
  codexProxyTimeout = setTimeout(() => {
    if (codexProxyServer === server) stopCodexProxy({ force: true });
  }, Math.max(0, deadline - Date.now()));
}

/**
 * Register a pending exchange session for server-side mode.
 * Modal client calls this before opening popup.
 */
export function registerCodexSession({ state, codeVerifier, redirectUri, proxyPoolId, proxyOptions }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  const registered = setBoundedSession(pendingExchanges, state, {
    codeVerifier,
    redirectUri,
    proxyPoolId,
    proxyOptions,
    status: "pending",
    createdAt: Date.now(),
  });
  if (registered) scheduleCodexProxyTimeout();
  return registered;
}

/**
 * Read session status (modal polls this).
 */
export function getCodexSessionStatus(state) {
  return publicSessionStatus(getLiveSession(pendingExchanges, state));
}

/**
 * Clear a session (called after modal consumes status).
 */
export function clearCodexSession(state, identity = null) {
  clearSession(pendingExchanges, state, identity);
  scheduleCodexProxyTimeout();
}

export function clearCodexSessions() {
  pendingExchanges.clear();
  scheduleCodexProxyTimeout();
}

export function claimCodexSession(state) {
  const session = claimLiveSession(pendingExchanges, state);
  return session ? { ...session } : null;
}

export function isCodexSessionCurrent(state, identity) {
  return isCurrentSession(pendingExchanges, state, identity);
}

function withProxyPoolData(providerSpecificData, proxyPoolId) {
  return {
    ...(providerSpecificData || {}),
    ...(proxyPoolId && proxyPoolId !== "__none__" ? { proxyPoolId } : {}),
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCodexResultPage(success, message) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  const safeMessage = escapeHtml(message);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${safeMessage}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`;
}

/**
 * Start Codex proxy on fixed port 1455.
 * Mode A (server-side): if any session was registered, proxy auto-exchanges + saves DB.
 * Mode B (channel fallback): if no session, proxy 302 redirects to app port for legacy channel-based flow.
 */
export async function startCodexProxy(appPort) {
  if (codexProxyClosing) await codexProxyClosing;
  codexProxyAppPort = appPort;
  if (codexProxyServer) return { success: true };
  if (codexProxyStarting) return codexProxyStarting;

  const starting = new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");

      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const session = claimLiveSession(pendingExchanges, state);

      // Mode A: server-side exchange (session registered)
      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          // Lazy import to avoid circular deps
          const { exchangeTokens } = await import("../providers.js");
          const { createProviderConnection } = await import("@/models");

          const tokenData = await exchangeTokens(
            "codex",
            code,
            session.redirectUri,
            session.codeVerifier,
            state,
            undefined,
            session.proxyOptions
          );
          if (!isCurrentSession(pendingExchanges, state, session.identity)) {
            throw new Error("OAuth flow was cancelled");
          }
          const connection = await createProviderConnection({
            provider: "codex",
            authType: "oauth",
            ...tokenData,
            providerSpecificData: withProxyPoolData(tokenData.providerSpecificData, session.proxyPoolId),
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          }, {
            beforePersist: () => isCurrentSession(pendingExchanges, state, session.identity),
          });

          session.status = "done";
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(true, "You can close this window."));
        } catch (err) {
          const publicError = sanitizeOAuthError(err);
          session.status = "error";
          session.error = publicError;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderCodexResultPage(false, publicError));
        } finally {
          stopCodexProxy();
        }
        return;
      }

      if (hasLiveSessions(pendingExchanges)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid or already used OAuth state");
        return;
      }

      // Mode B: legacy channel fallback — 302 redirect to app /callback
      const redirectUrl = `http://localhost:${codexProxyAppPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopCodexProxy();
    });

    server.listen(CODEX_PORT, "127.0.0.1", () => {
      codexProxyServer = server;
      scheduleCodexProxyTimeout();
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
  codexProxyStarting = starting;
  try {
    return await starting;
  } finally {
    if (codexProxyStarting === starting) codexProxyStarting = null;
  }
}

/**
 * Stop the Codex proxy server and cleanup
 */
export async function stopCodexProxy({ force = false, orphanOnly = false } = {}) {
  pruneExpiredSessions(pendingExchanges);
  if (orphanOnly && hasLiveSessions(pendingExchanges)) return false;
  if (!force && hasPendingSessions(pendingExchanges)) {
    scheduleCodexProxyTimeout();
    return false;
  }
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyStarting) await codexProxyStarting;
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyClosing) return codexProxyClosing;
  if (!codexProxyServer) return true;

  const server = codexProxyServer;
  codexProxyClosing = closeProxyServer(server).then(() => {
    if (codexProxyServer === server) codexProxyServer = null;
    if (codexProxyServer === null) codexProxyAppPort = null;
    codexProxyClosing = null;
  });
  await codexProxyClosing;
  return true;
}

// ───────────────────────────────────────────────────────────────────────────
// xAI fixed-port proxy on 127.0.0.1:56121
// Same shape as the Codex proxy. Kept as a parallel implementation rather than
// generalizing the Codex one to keep the codex hot-path byte-equivalent.
// ───────────────────────────────────────────────────────────────────────────

let xaiProxyServer = null;
let xaiProxyTimeout = null;
let xaiProxyClosing = null;
let xaiProxyStarting = null;
let xaiProxyAppPort = null;
const XAI_PROXY_TIMEOUT_MS = 300000; // 5 minutes
const XAI_PROXY_PORT = 56121;
const xaiPendingExchanges = new Map();

function scheduleXaiProxyTimeout() {
  if (xaiProxyTimeout) clearTimeout(xaiProxyTimeout);
  xaiProxyTimeout = null;
  if (!xaiProxyServer) return;

  const server = xaiProxyServer;
  const deadline = latestPendingSessionDeadline(xaiPendingExchanges) || Date.now() + XAI_PROXY_TIMEOUT_MS;
  xaiProxyTimeout = setTimeout(() => {
    if (xaiProxyServer === server) stopXaiProxy({ force: true });
  }, Math.max(0, deadline - Date.now()));
}

export function registerXaiSession({ state, codeVerifier, redirectUri, proxyPoolId, proxyOptions }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  const registered = setBoundedSession(xaiPendingExchanges, state, {
    codeVerifier,
    redirectUri,
    proxyPoolId,
    proxyOptions,
    status: "pending",
    createdAt: Date.now(),
  });
  if (registered) scheduleXaiProxyTimeout();
  return registered;
}

export function getXaiSessionStatus(state) {
  return publicSessionStatus(getLiveSession(xaiPendingExchanges, state));
}

export function getXaiSessionContext(state) {
  const session = getLiveSession(xaiPendingExchanges, state);
  return session ? { ...session } : null;
}

export function claimXaiSession(state) {
  const session = claimLiveSession(xaiPendingExchanges, state);
  return session ? { ...session } : null;
}

export function isXaiSessionCurrent(state, identity) {
  return isCurrentSession(xaiPendingExchanges, state, identity);
}

export function clearXaiSession(state, identity = null) {
  clearSession(xaiPendingExchanges, state, identity);
  scheduleXaiProxyTimeout();
}

export function clearXaiSessions() {
  xaiPendingExchanges.clear();
  scheduleXaiProxyTimeout();
}

function renderXaiResultPage(success, message) {
  return renderCodexResultPage(success, message);
}

/**
 * Start xAI proxy on fixed port 56121.
 * Mode A (server-side): if any session was registered, proxy auto-exchanges + saves DB.
 * Mode B (channel fallback): if no session, proxy 302 redirects to app port.
 */
export async function startXaiProxy(appPort) {
  if (xaiProxyClosing) await xaiProxyClosing;
  xaiProxyAppPort = appPort;
  if (xaiProxyServer) return { success: true };
  if (xaiProxyStarting) return xaiProxyStarting;

  const starting = new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== "/callback" && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const errorParam = url.searchParams.get("error");
      const session = claimLiveSession(xaiPendingExchanges, state);

      // Mode A: server-side exchange
      if (session) {
        try {
          if (errorParam) {
            throw new Error(url.searchParams.get("error_description") || errorParam);
          }
          if (!code) throw new Error("No authorization code received");

          const { exchangeTokens } = await import("../providers.js");
          const { createProviderConnection } = await import("@/models");

          const tokenData = await exchangeTokens(
            "xai",
            code,
            session.redirectUri,
            session.codeVerifier,
            state,
            undefined,
            session.proxyOptions
          );
          if (!isCurrentSession(xaiPendingExchanges, state, session.identity)) {
            throw new Error("OAuth flow was cancelled");
          }
          const connection = await createProviderConnection({
            provider: "xai",
            authType: "oauth",
            ...tokenData,
            providerSpecificData: withProxyPoolData(tokenData.providerSpecificData, session.proxyPoolId),
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          }, {
            beforePersist: () => isCurrentSession(xaiPendingExchanges, state, session.identity),
          });

          session.status = "done";
          session.connectionId = connection.id;
          session.email = connection.email;

          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(true, "You can close this window."));
        } catch (err) {
          const publicError = sanitizeOAuthError(err);
          session.status = "error";
          session.error = publicError;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(false, publicError));
        } finally {
          stopXaiProxy();
        }
        return;
      }

      if (hasLiveSessions(xaiPendingExchanges)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Invalid or already used OAuth state");
        return;
      }

      // Mode B: legacy fallback redirect
      const redirectUrl = `http://localhost:${xaiProxyAppPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopXaiProxy();
    });

    server.listen(XAI_PROXY_PORT, "127.0.0.1", () => {
      xaiProxyServer = server;
      scheduleXaiProxyTimeout();
      resolve({ success: true });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve({ success: false, reason: "port_busy" });
      } else {
        resolve({ success: false, reason: err.message });
      }
    });
  });
  xaiProxyStarting = starting;
  try {
    return await starting;
  } finally {
    if (xaiProxyStarting === starting) xaiProxyStarting = null;
  }
}

export async function stopXaiProxy({ force = false, orphanOnly = false } = {}) {
  pruneExpiredSessions(xaiPendingExchanges);
  if (orphanOnly && hasLiveSessions(xaiPendingExchanges)) return false;
  if (!force && hasPendingSessions(xaiPendingExchanges)) {
    scheduleXaiProxyTimeout();
    return false;
  }
  if (xaiProxyTimeout) {
    clearTimeout(xaiProxyTimeout);
    xaiProxyTimeout = null;
  }
  if (xaiProxyStarting) await xaiProxyStarting;
  if (xaiProxyTimeout) {
    clearTimeout(xaiProxyTimeout);
    xaiProxyTimeout = null;
  }
  if (xaiProxyClosing) return xaiProxyClosing;
  if (!xaiProxyServer) return true;

  const server = xaiProxyServer;
  xaiProxyClosing = closeProxyServer(server).then(() => {
    if (xaiProxyServer === server) xaiProxyServer = null;
    if (xaiProxyServer === null) xaiProxyAppPort = null;
    xaiProxyClosing = null;
  });
  await xaiProxyClosing;
  return true;
}
// ───────────────────────────────────────────────────────────────────────────
// Trae dynamic-port proxy. Singleton session (one connect at a time per provider).
// Callback path = /callback with params refreshToken + loginHost.
// ───────────────────────────────────────────────────────────────────────────

let traeProxyServer = null;
let traeProxyTimeout = null;
let traeProxyPort = null;
let traeSession = null;

export function registerTraeSession({ state }) {
  if (!state) return false;
  traeSession = { state, status: "pending", createdAt: Date.now() };
  return true;
}
export function getTraeSessionStatus(state) {
  if (!traeSession) return null;
  if (state && traeSession.state !== state) return null;
  return traeSession;
}
export function clearTraeSession(state) {
  if (!state || (traeSession && traeSession.state === state)) traeSession = null;
}

export function startTraeProxy() {
  return new Promise((resolve) => {
    if (traeProxyServer) {
      resolve({ success: true, port: traeProxyPort, callbackUrl: `http://127.0.0.1:${traeProxyPort}${TRAE_CONFIG.callbackPath}` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== TRAE_CONFIG.callbackPath && url.pathname !== "/auth/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = traeSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Trae login session"));
        return;
      }
      // Anti-CSRF: reject cross-origin fetches (legit redirects send no Origin),
      // and reject state mismatch when state is present.
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const cbState = url.searchParams.get("state");
      if (cbState && session.state && cbState !== session.state) {
        session.status = "error";
        session.error = "Trae callback state mismatch";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, session.error));
        stopTraeProxy();
        return;
      }
      // Pass the raw callback query to exchangeTokens → parseTraeCallback
      const rawCallback = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("trae", rawCallback);
        const connection = await createProviderConnection({
          provider: "trae",
          authType: "oauth",
          ...tokenData,
          expiresAt: tokenData.expiresIn
            ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
            : null,
          testStatus: "active",
        });
        session.status = "done";
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(true, "You can close this window."));
      } catch (err) {
        session.status = "error";
        session.error = err.message;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, err.message));
      } finally {
        stopTraeProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      traeProxyServer = server;
      traeProxyPort = server.address().port;
      traeProxyTimeout = setTimeout(() => stopTraeProxy(), TRAE_CONFIG.oauthTimeoutMs);
      resolve({ success: true, port: traeProxyPort, callbackUrl: `http://127.0.0.1:${traeProxyPort}${TRAE_CONFIG.callbackPath}` });
    });
    server.on("error", (err) => resolve({ success: false, reason: err.message }));
  });
}

export function stopTraeProxy() {
  if (traeProxyTimeout) { clearTimeout(traeProxyTimeout); traeProxyTimeout = null; }
  if (traeProxyServer) { traeProxyServer.close(); traeProxyServer = null; }
  traeProxyPort = null;
}

// ───────────────────────────────────────────────────────────────────────────
// Windsurf dynamic-port proxy. Singleton session.
// Callback path = /windsurf-auth-callback with params access_token (firebase JWT) + state.
// ───────────────────────────────────────────────────────────────────────────

let windsurfProxyServer = null;
let windsurfProxyTimeout = null;
let windsurfProxyPort = null;
let windsurfSession = null;

export function registerWindsurfSession({ state }) {
  if (!state) return false;
  windsurfSession = { state, status: "pending", createdAt: Date.now() };
  return true;
}
export function getWindsurfSessionStatus(state) {
  if (!windsurfSession) return null;
  if (state && windsurfSession.state !== state) return null;
  return windsurfSession;
}
export function clearWindsurfSession(state) {
  if (!state || (windsurfSession && windsurfSession.state === state)) windsurfSession = null;
}

export function startWindsurfProxy() {
  return new Promise((resolve) => {
    if (windsurfProxyServer) {
      resolve({ success: true, port: windsurfProxyPort, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${WINDSURF_CONFIG.callbackPath}` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname !== WINDSURF_CONFIG.callbackPath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = windsurfSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Windsurf login session"));
        return;
      }
      // Anti-CSRF: reject cross-origin fetches, and require state present + matching.
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      const cbState = url.searchParams.get("state");
      if (!cbState || !session.state || cbState !== session.state) {
        session.status = "error";
        session.error = "Windsurf callback state mismatch";
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, session.error));
        stopWindsurfProxy();
        return;
      }
      const rawCallback = `${url.pathname}?${url.searchParams.toString()}`;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("windsurf", rawCallback, null, null, session.state);
        const connection = await createProviderConnection({
          provider: "windsurf",
          authType: "api_key",
          ...tokenData,
          testStatus: "active",
        });
        session.status = "done";
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(true, "You can close this window."));
      } catch (err) {
        session.status = "error";
        session.error = err.message;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, err.message));
      } finally {
        stopWindsurfProxy();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      windsurfProxyServer = server;
      windsurfProxyPort = server.address().port;
      windsurfProxyTimeout = setTimeout(() => stopWindsurfProxy(), WINDSURF_CONFIG.oauthTimeoutMs);
      resolve({ success: true, port: windsurfProxyPort, callbackUrl: `http://127.0.0.1:${windsurfProxyPort}${WINDSURF_CONFIG.callbackPath}` });
    });
    server.on("error", (err) => resolve({ success: false, reason: err.message }));
  });
}

export function stopWindsurfProxy() {
  if (windsurfProxyTimeout) { clearTimeout(windsurfProxyTimeout); windsurfProxyTimeout = null; }
  if (windsurfProxyServer) { windsurfProxyServer.close(); windsurfProxyServer = null; }
  windsurfProxyPort = null;
}

// ───────────────────────────────────────────────────────────────────────────
// Zed RSA native-app proxy. Singleton session.
// Callback: GET http://127.0.0.1:<port>/?user_id=...&access_token=<RSA-encrypted>
// The proxy decrypts the access token using the private key stored in session.codeVerifier.
// ───────────────────────────────────────────────────────────────────────────

let zedProxyServer = null;
let zedProxyTimeout = null;
let zedProxyPort = null;
let zedSession = null;

export function registerZedSession({ state, codeVerifier }) {
  if (!state || !codeVerifier) return false;
  zedSession = { state, codeVerifier, status: "pending", createdAt: Date.now() };
  return true;
}
export function getZedSessionStatus(state) {
  if (!zedSession) return null;
  if (state && zedSession.state !== state) return null;
  return zedSession;
}
export function clearZedSession(state) {
  if (!state || (zedSession && zedSession.state === state)) zedSession = null;
}

export function startZedProxy(preferredPort = 0) {
  return new Promise((resolve) => {
    if (zedProxyServer) {
      resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
      return;
    }
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost");
      // Log path + redacted params (access_token is the RSA-encrypted credential).
      const redacted = Object.fromEntries(url.searchParams);
      for (const k of ["access_token", "user_id", "code_verifier", "state"]) {
        if (redacted[k]) redacted[k] = "<redacted>";
      }
      console.log("[Zed proxy]", req.method, url.pathname, JSON.stringify(redacted));
      if (url.pathname !== "/" && url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const session = zedSession;
      if (!session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "No active Zed login session"));
        return;
      }
      // Anti-CSRF: Zed tokens are RSA-encrypted to our keypair so they can't be
      // forged cross-site, but still reject cross-origin fetches for defense-in-depth.
      if (!isLoopbackOrigin(req.headers.origin)) {
        res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, "Cross-origin callback rejected"));
        return;
      }
      // Pass raw callback path+query to exchangeTokens → parseZedCallbackPayload.
      // codeVerifier carries the encoded RSA private key for decryption.
      const rawCallback = url.search ? `${url.pathname}?${url.searchParams.toString()}` : url.pathname;
      try {
        const { exchangeTokens } = await import("../providers.js");
        const { createProviderConnection } = await import("@/models");
        const tokenData = await exchangeTokens("zed", rawCallback, null, session.codeVerifier, session.state);
        const connection = await createProviderConnection({
          provider: "zed",
          authType: "oauth",
          ...tokenData,
          testStatus: "active",
        });
        session.status = "done";
        session.connectionId = connection.id;
        session.email = connection.email;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(true, "You can close this window."));
      } catch (err) {
        session.status = "error";
        session.error = err.message;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderCodexResultPage(false, err.message));
      } finally {
        stopZedProxy();
      }
    });
    const tryPort = Number(preferredPort) || 0;
    server.on("error", (err) => {
      // If the preferred port (e.g. 58443) is busy, fall back to a random port.
      if (err.code === "EADDRINUSE" && tryPort !== 0) {
        console.log(`[Zed proxy] port ${tryPort} busy, falling back to random`);
        server.listen(0, "127.0.0.1", () => {
          zedProxyServer = server;
          zedProxyPort = server.address().port;
          zedProxyTimeout = setTimeout(() => stopZedProxy(), ZED_HOSTED_CONFIG.oauthTimeoutMs);
          console.log(`[Zed proxy] listening on random port ${zedProxyPort}`);
          resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
        });
      } else {
        console.log(`[Zed proxy] listen error: ${err.message}`);
        resolve({ success: false, reason: err.message });
      }
    });
    server.listen(tryPort, "127.0.0.1", () => {
      zedProxyServer = server;
      zedProxyPort = server.address().port;
      zedProxyTimeout = setTimeout(() => { console.log("[Zed proxy] timeout, stopping"); stopZedProxy(); }, ZED_HOSTED_CONFIG.oauthTimeoutMs);
      console.log(`[Zed proxy] listening on port ${zedProxyPort}`);
      resolve({ success: true, port: zedProxyPort, callbackUrl: `http://127.0.0.1:${zedProxyPort}/` });
    });
  });
}

export function stopZedProxy() {
  console.log(`[Zed proxy] stopping (port ${zedProxyPort || "-"})`);
  if (zedProxyTimeout) { clearTimeout(zedProxyTimeout); zedProxyTimeout = null; }
  if (zedProxyServer) { zedProxyServer.close(); zedProxyServer = null; }
  zedProxyPort = null;
}

