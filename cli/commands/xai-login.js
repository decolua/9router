#!/usr/bin/env node
/**
 * xAI (Grok) CLI Login
 *
 * Source of truth for OAuth details: router-for-me/CLIProxyAPI internal/cmd/xai_login.go
 * Persistence is delegated to the running 9router server API so this command can
 * run as a standalone Node script without importing Next.js app internals.
 */

const http = require("http");
const readline = require("readline");
const { spawn } = require("child_process");
const api = require("../src/cli/api/client.js");

const DEFAULT_PORT = 20128;
const XAI_LOOPBACK_PORT = 56121;
const XAI_CALLBACK_PATH = "/callback";
const XAI_REDIRECT_URI = `http://127.0.0.1:${XAI_LOOPBACK_PORT}${XAI_CALLBACK_PATH}`;

function parseArgs(argv) {
  const opts = { apiKey: null, port: DEFAULT_PORT, host: "localhost" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--api-key" && i + 1 < argv.length) {
      opts.apiKey = argv[++i];
    } else if ((arg === "--port" || arg === "-p") && i + 1 < argv.length) {
      opts.port = Number.parseInt(argv[++i], 10) || DEFAULT_PORT;
    } else if ((arg === "--host" || arg === "-H") && i + 1 < argv.length) {
      opts.host = argv[++i] || "localhost";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: xai-login [options]

Options:
  --api-key <KEY>     Save a direct xAI API key instead of OAuth.
  -p, --port <port>   9router server port (default: ${DEFAULT_PORT}).
  -H, --host <host>   9router server host (default: localhost).
  -h, --help          Show this help.

Without --api-key, the OAuth PKCE flow uses ${XAI_REDIRECT_URI}.
The 9router server must be running so credentials can be saved.
`);
}

function openBrowser(url) {
  const command = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function startCallbackServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname !== XAI_CALLBACK_PATH) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const params = Object.fromEntries(url.searchParams);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!doctype html><title>xAI connected</title><p>xAI authentication complete. You can close this tab.</p>");
      server.emit("xai-callback", params);
    });

    server.listen(XAI_LOOPBACK_PORT, "127.0.0.1", () => {
      resolve({
        close: () => server.close(),
        waitForCallback: () => new Promise((resolveCallback, rejectCallback) => {
          const timeout = setTimeout(() => rejectCallback(new Error("Authentication timeout")), 300000);
          server.once("xai-callback", (params) => {
            clearTimeout(timeout);
            resolveCallback(params);
          });
        }),
      });
    });
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${XAI_LOOPBACK_PORT} is already in use`));
      } else {
        reject(err);
      }
    });
  });
}

function promptManualCode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("Paste the xAI callback Token (or press Enter to keep waiting): ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function waitForCallbackOrManualCode(callbackServer, state) {
  const callbackPromise = callbackServer.waitForCallback().then((params) => ({ type: "callback", params }));
  let manualPromptTimer = null;
  const manualPromptPromise = new Promise((resolve) => {
    manualPromptTimer = setTimeout(() => {
      promptManualCode().then((code) => resolve({ type: "manual", code }));
    }, 15000);
  });

  const first = await Promise.race([callbackPromise, manualPromptPromise]);
  if (first.type === "callback") {
    clearTimeout(manualPromptTimer);
    return first.params;
  }

  if (first.code) {
    if (first.code.includes("://") || first.code.includes("?") || first.code.includes("code=")) {
      throw new Error("Paste only the xAI callback Token");
    }
    return { code: first.code, state };
  }

  return (await callbackPromise).params;
}

async function saveApiKey(apiKey) {
  const result = await api.createApiKeyProvider({
    provider: "xai",
    name: "xAI API Key",
    apiKey,
    priority: 1,
    testStatus: "unknown",
  });
  if (!result.success) throw new Error(result.error);
  return result.data.connection;
}

async function getAuthData() {
  const path = `/api/oauth/xai/authorize?redirect_uri=${encodeURIComponent(XAI_REDIRECT_URI)}`;
  const result = await api.makeRequest("GET", path);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

async function exchangeCode({ code, state, codeVerifier }) {
  const result = await api.makeRequest("POST", "/api/oauth/xai/exchange", {
    code,
    state,
    codeVerifier,
    redirectUri: XAI_REDIRECT_URI,
  });
  if (!result.success) throw new Error(result.error);
  return result.data.connection;
}

async function runOAuth() {
  const authData = await getAuthData();
  const callbackServer = await startCallbackServer();
  try {
    console.log("Opening browser for xAI authentication...");
    console.log(`If browser does not open, visit:\n${authData.authUrl}\n`);
    openBrowser(authData.authUrl);

    const params = await waitForCallbackOrManualCode(callbackServer, authData.state);
    if (params.error) throw new Error(params.error_description || params.error);
    if (!params.code) throw new Error("No authorization code received");
    if (params.state !== authData.state) throw new Error("Invalid state parameter");

    return await exchangeCode({
      code: params.code,
      state: params.state,
      codeVerifier: authData.codeVerifier,
    });
  } finally {
    callbackServer.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  api.configure({ host: opts.host, port: opts.port });

  if (opts.apiKey) {
    const connection = await saveApiKey(opts.apiKey);
    console.log("xAI API key saved as connection %s.", connection.id);
    return;
  }

  const connection = await runOAuth();
  console.log("xAI OAuth saved as connection %s.", connection.id);
  if (connection.email || connection.displayName) {
    console.log("Account: %s", connection.email || connection.displayName);
  }
}

main().catch((err) => {
  console.error("xai-login failed:", err?.message || err);
  process.exit(1);
});
