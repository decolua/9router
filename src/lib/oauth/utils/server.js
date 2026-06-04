import http from "http";
import { URL } from "url";

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

const CODEX_PROXY_TIMEOUT_MS = 300000; // 5 minutes
const CODEX_PORT = 1455;

// Pending exchange sessions keyed by state — used by server-side exchange mode
const pendingExchanges = new Map();

/**
 * Register a pending exchange session for server-side mode.
 * Modal client calls this before opening popup.
 */
export function registerCodexSession({ state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  pendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

/**
 * Read session status (modal polls this).
 */
export function getCodexSessionStatus(state) {
  return pendingExchanges.get(state) || null;
}

/**
 * Clear a session (called after modal consumes status).
 */
export function clearCodexSession(state) {
  pendingExchanges.delete(state);
}

function renderCodexResultPage(success, message) {
  const color = success ? "#22c55e" : "#ef4444";
  const icon = success ? "&#10003;" : "&#10007;";
  const title = success ? "Authentication Successful" : "Authentication Failed";
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#f5f5f5}.c{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.1)}.i{color:${color};font-size:3rem}h1{margin:1rem 0}p{color:#666}</style>
</head><body><div class="c"><div class="i">${icon}</div><h1>${title}</h1><p>${message}</p><p>Closing in <span id="cd">3</span>s...</p>
<script>let n=3;const c=document.getElementById("cd");const t=setInterval(()=>{n--;c.textContent=n;if(n<=0){clearInterval(t);window.close();}},1000);</script>
</div></body></html>`;
}

/**
 * Start Codex proxy on fixed port 1455.
 * Mode A (server-side): if any session was registered, proxy auto-exchanges + saves DB.
 * Mode B (channel fallback): if no session, proxy 302 redirects to app port for legacy channel-based flow.
 */
export function startCodexProxy(appPort) {
  return new Promise((resolve) => {
    if (codexProxyServer) {
      resolve({ success: true });
      return;
    }

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
      const session = state ? pendingExchanges.get(state) : null;

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
            state
          );
          const connection = await createProviderConnection({
            provider: "codex",
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
          stopCodexProxy();
        }
        return;
      }

      // Mode B: legacy channel fallback — 302 redirect to app /callback
      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopCodexProxy();
    });

    server.listen(CODEX_PORT, "127.0.0.1", () => {
      codexProxyServer = server;
      codexProxyTimeout = setTimeout(() => stopCodexProxy(), CODEX_PROXY_TIMEOUT_MS);
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
}

/**
 * Stop the Codex proxy server and cleanup
 */
export function stopCodexProxy() {
  if (codexProxyTimeout) {
    clearTimeout(codexProxyTimeout);
    codexProxyTimeout = null;
  }
  if (codexProxyServer) {
    codexProxyServer.close();
    codexProxyServer = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// xAI fixed-port proxy on 127.0.0.1:56121
// Same shape as the Codex proxy. Kept as a parallel implementation rather than
// generalizing the Codex one to keep the codex hot-path byte-equivalent.
// ───────────────────────────────────────────────────────────────────────────

let xaiProxyServer = null;
let xaiProxyTimeout = null;
const XAI_PROXY_TIMEOUT_MS = 300000; // 5 minutes
const XAI_PROXY_PORT = 56121;
const xaiPendingExchanges = new Map();

export function registerXaiSession({ state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  xaiPendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getXaiSessionStatus(state) {
  return xaiPendingExchanges.get(state) || null;
}

export function clearXaiSession(state) {
  xaiPendingExchanges.delete(state);
}

function renderXaiResultPage(success, message) {
  return renderCodexResultPage(success, message);
}

/**
 * Start xAI proxy on fixed port 56121.
 * Mode A (server-side): if any session was registered, proxy auto-exchanges + saves DB.
 * Mode B (channel fallback): if no session, proxy 302 redirects to app port.
 */
export function startXaiProxy(appPort) {
  return new Promise((resolve) => {
    if (xaiProxyServer) {
      resolve({ success: true });
      return;
    }

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
      const session = state ? xaiPendingExchanges.get(state) : null;

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
            state
          );
          const connection = await createProviderConnection({
            provider: "xai",
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
          res.end(renderXaiResultPage(true, "You can close this window."));
        } catch (err) {
          session.status = "error";
          session.error = err.message;
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(renderXaiResultPage(false, err.message));
        } finally {
          stopXaiProxy();
        }
        return;
      }

      // Mode B: legacy fallback redirect
      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;
      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopXaiProxy();
    });

    server.listen(XAI_PROXY_PORT, "127.0.0.1", () => {
      xaiProxyServer = server;
      xaiProxyTimeout = setTimeout(() => stopXaiProxy(), XAI_PROXY_TIMEOUT_MS);
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
}

export function stopXaiProxy() {
  if (xaiProxyTimeout) {
    clearTimeout(xaiProxyTimeout);
    xaiProxyTimeout = null;
  }
  if (xaiProxyServer) {
    xaiProxyServer.close();
    xaiProxyServer = null;
  }
}

