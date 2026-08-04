import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { parseTOML, stringifyTOML } from "confbox";
import { DATA_DIR } from "@/lib/dataDir.js";
import { getInstalledCodexClientVersion } from "@/lib/codexNative/clientVersion.js";
import {
  getCodexNativeMetrics,
  getCodexNativeWebSocketEligibility,
} from "@/lib/codexNative/pool.js";
import { getCodexNativeCatalog } from "@/lib/codexNative/catalog.js";
import { CODEX_NATIVE_CONFIG } from "open-sse/config/codexNative.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_FILE = path.join(DATA_DIR, "codex-native", "readiness.json");
const SECRET_FILE = path.join(DATA_DIR, "secrets", "codex-bridge-token");
const CONFIG_FILE = path.join(os.homedir(), ".codex", "config.toml");

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

async function atomicWrite(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { mode: 0o600 });
  await fs.rename(temporary, file);
  try { await fs.chmod(file, 0o600); } catch { /* Windows */ }
}

function providerBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function wsUrl(baseUrl) {
  const url = new URL(`${providerBaseUrl(baseUrl)}/responses`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function probeWebSocket(baseUrl, apiKey, clientVersion, timeoutMs = 8_000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const socket = new WebSocket(wsUrl(baseUrl), {
      headers: {
        authorization: `Bearer ${apiKey}`,
        originator: "codex_cli_rs",
        "user-agent": "9router-readiness",
        "x-codex-client-version": clientVersion,
      },
      handshakeTimeout: timeoutMs,
      perMessageDeflate: true,
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, "readiness complete");
      else socket.terminate();
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    const timer = setTimeout(() => finish({ ok: false, error: "WebSocket probe timed out" }), timeoutMs);
    socket.once("open", () => finish({ ok: true }));
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      finish({ ok: false, status: response.statusCode, error: `Upgrade returned ${response.statusCode}` });
    });
    socket.once("error", (error) => finish({ ok: false, error: error.message }));
  });
}

async function probeModels(baseUrl, apiKey, clientVersion) {
  const url = new URL(`${providerBaseUrl(baseUrl)}/models`);
  url.searchParams.set("client_version", clientVersion);
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "user-agent": "9router-readiness",
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok && Array.isArray(payload.models) && payload.models.length > 0,
    status: response.status,
    modelCount: Array.isArray(payload.models) ? payload.models.length : 0,
    error: response.ok ? null : payload?.error?.message || `Models returned ${response.status}`,
  };
}

async function configuredProviderBaseUrl() {
  try {
    const parsed = parseTOML(await fs.readFile(CONFIG_FILE, "utf8")) || {};
    return parsed?.model_providers?.[CODEX_NATIVE_CONFIG.providerConfigId]?.base_url || null;
  } catch {
    return null;
  }
}

async function writeSupportsWebSockets(value) {
  let parsed;
  try {
    parsed = parseTOML(await fs.readFile(CONFIG_FILE, "utf8")) || {};
  } catch {
    return false;
  }
  const provider = parsed?.model_providers?.[CODEX_NATIVE_CONFIG.providerConfigId];
  if (!provider) return false;
  provider.supports_websockets = value === true;
  await atomicWrite(CONFIG_FILE, stringifyTOML(parsed));
  return true;
}

export async function GET() {
  const [last, metrics] = await Promise.all([
    readJson(STATE_FILE),
    Promise.resolve(getCodexNativeMetrics()),
  ]);
  return Response.json({
    last,
    metrics,
    wsDisabled: /^(1|true|yes|on)$/i.test(process.env.CODEX_NATIVE_WS_DISABLED || ""),
  });
}

export async function POST(request) {
  let input = {};
  try { input = await request.json(); } catch { /* optional body */ }
  const origin = new URL(request.url).origin;
  const localBaseUrl = `${origin}/v1/codex`;
  const configuredBase = providerBaseUrl(input.baseUrl || await configuredProviderBaseUrl() || localBaseUrl);
  const installedVersion = await getInstalledCodexClientVersion({ forceRefresh: true });
  const clientVersion = String(input.clientVersion || installedVersion.version || "").trim();
  let apiKey;
  try {
    apiKey = String(input.apiKey || await fs.readFile(SECRET_FILE, "utf8")).trim();
  } catch {
    apiKey = "";
  }

  const checkedAt = new Date().toISOString();
  const result = {
    checkedAt,
    clientVersion: clientVersion || null,
    configuredBaseUrl: configuredBase,
    auth: { ok: !!apiKey },
    models: { ok: false },
    localWebSocket: { ok: false },
    configuredWebSocket: { ok: false },
    upstreamHandshake: { ok: false },
    httpFallback: { ok: false },
    eligibleAccounts: [],
    supportsWebSockets: false,
  };

  try {
    if (!clientVersion) throw new Error("Codex client version could not be detected");
    const catalog = await getCodexNativeCatalog({ forceRefresh: true, clientVersion });
    result.catalog = {
      source: catalog.source,
      stale: catalog.stale === true,
      clientVersion: catalog.clientVersion,
      fetchedAt: new Date(catalog.fetchedAt).toISOString(),
    };
    result.eligibleAccounts = await getCodexNativeWebSocketEligibility({ clientVersion });
  } catch (error) {
    result.catalog = { error: error.message };
  }

  if (apiKey) {
    try {
      if (!clientVersion) throw new Error("Codex client version could not be detected");
      result.models = await probeModels(configuredBase, apiKey, clientVersion);
      result.httpFallback = {
        ok: result.models.ok,
        detail: "Models endpoint proves authenticated HTTP fallback without creating a completion",
      };
    } catch (error) {
      result.models = { ok: false, error: error.message };
      result.httpFallback = { ok: false, error: error.message };
    }

    const disabled = /^(1|true|yes|on)$/i.test(process.env.CODEX_NATIVE_WS_DISABLED || "");
    if (!disabled) {
      result.localWebSocket = await probeWebSocket(localBaseUrl, apiKey, clientVersion);
      result.configuredWebSocket = configuredBase === localBaseUrl
        ? result.localWebSocket
        : await probeWebSocket(configuredBase, apiKey, clientVersion);
      result.upstreamHandshake = {
        ...result.configuredWebSocket,
        detail: "The local gateway only returns 101 after its upstream ChatGPT handshake succeeds",
      };
    } else {
      const error = "Disabled by CODEX_NATIVE_WS_DISABLED";
      result.localWebSocket = { ok: false, error };
      result.configuredWebSocket = { ok: false, error };
      result.upstreamHandshake = { ok: false, error };
    }
  }

  const wsEligible = result.eligibleAccounts.some((account) => account.eligible);
  result.supportsWebSockets = result.auth.ok
    && result.models.ok
    && result.configuredWebSocket.ok
    && result.upstreamHandshake.ok
    && wsEligible;
  result.configUpdated = await writeSupportsWebSockets(result.supportsWebSockets);
  await atomicWrite(STATE_FILE, JSON.stringify(result, null, 2));
  return Response.json(result, { status: result.models.ok ? 200 : 503 });
}
