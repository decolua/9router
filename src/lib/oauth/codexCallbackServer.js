import http from "http";
import { URL } from "url";

const CALLBACK_PORT = 1455;
const CALLBACK_HOST = "127.0.0.1";

function buildHtml(payload) {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Codex OAuth Callback</title>
  <style>
    body { font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f6f7f9; }
    .card { background: white; padding: 24px; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); max-width: 520px; text-align: center; }
    .title { font-size: 18px; font-weight: 600; margin-bottom: 8px; }
    .muted { color: #6b7280; font-size: 14px; }
    code { display: block; margin-top: 12px; padding: 8px 10px; background: #f3f4f6; border-radius: 8px; font-size: 12px; word-break: break-all; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">Authorization complete</div>
    <div class="muted" id="status">Sending data back to 9Router...</div>
    <code id="fallback"></code>
  </div>
  <script>
    const payload = ${safePayload};
    const fallback = document.getElementById("fallback");
    const status = document.getElementById("status");

    const targetUrl = payload.appCallbackUrl || payload.fullUrl || "";
    status.textContent = "Please copy this URL into 9Router";
    fallback.textContent = targetUrl;
  </script>
</body>
</html>`;
}

export function startCodexCallbackServer() {
  if (globalThis.__codexCallbackServer) return globalThis.__codexCallbackServer;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${CALLBACK_HOST}`);
    if (url.pathname === "/auth/callback") {
      const params = Object.fromEntries(url.searchParams.entries());
      const statePayload = decodeState(params.state);
      if (statePayload?.appOrigin) {
        try {
          const appUrl = new URL("/callback", statePayload.appOrigin);
          url.searchParams.forEach((value, key) => {
            if (key !== "state") appUrl.searchParams.append(key, value);
          });
          appUrl.searchParams.set("state", statePayload.s);
          params.state = statePayload.s;
          params.appCallbackUrl = appUrl.toString();
        } catch {
          // ignore invalid origin
        }
      }
      const payload = {
        code: params.code || null,
        state: params.state || null,
        error: params.error || null,
        errorDescription: params.error_description || null,
        fullUrl: url.toString(),
        appCallbackUrl: params.appCallbackUrl || null,
      };
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildHtml(payload));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.log(`[codex-callback] Port ${CALLBACK_PORT} already in use.`);
      return;
    }
    console.log("[codex-callback] Server error:", err);
  });

  server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
    console.log(`[codex-callback] Listening on http://${CALLBACK_HOST}:${CALLBACK_PORT}/auth/callback`);
  });

  globalThis.__codexCallbackServer = server;
  return server;
}

function decodeState(state) {
  if (!state) return null;
  try {
    const json = Buffer.from(state, "base64url").toString("utf-8");
    const payload = JSON.parse(json);
    if (!payload || typeof payload !== "object") return null;
    if (!payload.s || !payload.appOrigin) return null;
    return payload;
  } catch {
    return null;
  }
}
