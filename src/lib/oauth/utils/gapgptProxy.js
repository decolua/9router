import http from "http";
import { URL } from "url";
import { GAPGPT_CONFIG } from "../constants/oauth.js";

let gapgptProxyServer = null;
let gapgptProxyTimeout = null;
const GAPGPT_PROXY_TIMEOUT_MS = 300000; // 5 minutes
const GAPGPT_PROXY_PORT = GAPGPT_CONFIG.fixedPort;
const gapgptPendingExchanges = new Map();

export function registerGapgptSession({ state, codeVerifier, redirectUri }) {
  if (!state || !codeVerifier || !redirectUri) return false;
  gapgptPendingExchanges.set(state, {
    codeVerifier,
    redirectUri,
    status: "pending",
    createdAt: Date.now(),
  });
  return true;
}

export function getGapgptSessionStatus(state) {
  return gapgptPendingExchanges.get(state) || null;
}

export function clearGapgptSession(state) {
  gapgptPendingExchanges.delete(state);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderResultPage(success, message) {
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

export function startGapgptProxy(appPort) {
  return new Promise((resolve) => {
    if (gapgptProxyServer) {
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
      const session = state ? gapgptPendingExchanges.get(state) : null;

      if (session) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(renderResultPage(true, "Processing sign-in… you can return to 9Router."));

        (async () => {
          try {
            if (errorParam) {
              throw new Error(url.searchParams.get("error_description") || errorParam);
            }
            if (!code) throw new Error("No authorization code received");

            const { exchangeTokens } = await import("../providers.js");
            const { createProviderConnection } = await import("@/models");

            const tokenData = await exchangeTokens(
              "gapgpt",
              code,
              session.redirectUri,
              session.codeVerifier,
              state
            );
            
            if (!tokenData?.accessToken) {
              throw new Error("GapGPT token exchange returned no credential");
            }
            
            const connection = await createProviderConnection({
              provider: "gapgpt",
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
          } catch (err) {
            session.status = "error";
            session.error = err.message;
          } finally {
            stopGapgptProxy();
          }
        })();
        return;
      }

      const redirectUrl = `http://localhost:${appPort}/callback${url.search}`;

      res.writeHead(302, { Location: redirectUrl });
      res.end();
      stopGapgptProxy();
    });

    server.listen(GAPGPT_PROXY_PORT, "127.0.0.1", () => {
      gapgptProxyServer = server;
      gapgptProxyTimeout = setTimeout(() => stopGapgptProxy(), GAPGPT_PROXY_TIMEOUT_MS);
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

export function stopGapgptProxy() {
  if (gapgptProxyTimeout) {
    clearTimeout(gapgptProxyTimeout);
    gapgptProxyTimeout = null;
  }
  if (gapgptProxyServer) {
    gapgptProxyServer.close();
    gapgptProxyServer = null;
  }
}
