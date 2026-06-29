// Claude auto-ping scheduler: warms the 5h window by sending a tiny request right after reset.
import "open-sse/index.js";

import { getSettings, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getClaudeUsage } from "open-sse/services/usage/claude.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "open-sse/providers/shared.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { CLAUDE_AUTOPING_CONFIG } from "@/shared/constants/config";

const C = CLAUDE_AUTOPING_CONFIG;
const PING_URL = "https://api.anthropic.com/v1/messages?beta=true";

const g = (global.__claudeAutoPing ??= { interval: null, running: false, resetCache: {} });

function buildProxyOptions(cfg) {
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

// Send minimal "hi" to start a fresh 5h window
async function sendPing(accessToken, proxyOptions) {
  const res = await proxyAwareFetch(PING_URL, {
    method: "POST",
    headers: {
      ...CLAUDE_CLI_SPOOF_HEADERS,
      "Authorization": `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: C.pingModel,
      max_tokens: C.pingMaxTokens,
      messages: [{ role: "user", content: C.pingText }],
    }),
  }, proxyOptions);
  return res.ok;
}

async function pingConnection(conn) {
  // Cached resetAt is stable for the whole 5h window; skip usage poll until near reset
  const cachedReset = g.resetCache[conn.id];
  if (cachedReset && Date.now() < new Date(cachedReset).getTime() - C.refreshAheadMs) return;

  const proxyCfg = await resolveConnectionProxyConfig(conn.providerSpecificData);
  const proxyOptions = buildProxyOptions(proxyCfg);

  // Refresh token if needed, then read 5h reset time
  let connection = conn;
  try {
    const r = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    connection = r.connection;
  } catch (e) {
    console.warn(`[AutoPing] ${conn.id}: refresh failed: ${e.message}`);
    return;
  }

  const usage = await getClaudeUsage(connection.accessToken, proxyOptions);
  const resetAt = usage?.quotas?.[C.fiveHourKey]?.resetAt;
  if (!resetAt) return;

  // Cache resetAt to gate future ticks
  g.resetCache[conn.id] = resetAt;

  const resetMs = new Date(resetAt).getTime();
  const now = Date.now();

  // Only ping once per reset cycle, right after window flips
  if (now < resetMs - C.pingLeadMs) return;
  if (connection.lastPingedResetAt === resetAt) return;

  const ok = await sendPing(connection.accessToken, proxyOptions);
  await updateProviderConnection(connection.id, {
    lastPingedResetAt: resetAt,
    lastPingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`[AutoPing] ${connection.id}: ping ${ok ? "sent" : "failed"} (reset ${resetAt})`);
}

async function tick() {
  if (g.running) return;
  g.running = true;
  try {
    const settings = await getSettings();
    const enabledMap = settings[C.settingsKey]?.connections || {};
    if (Object.keys(enabledMap).length === 0) return;

    const conns = await getProviderConnections({ provider: "claude", isActive: true });
    // Only ping connections the user explicitly enabled
    const targets = conns.filter((c) => c.authType === "oauth" && enabledMap[c.id] === true);
    if (targets.length === 0) return;

    for (const conn of targets) {
      try {
        await pingConnection(conn);
      } catch (e) {
        console.warn(`[AutoPing] ${conn.id}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn("[AutoPing] tick error:", e.message);
  } finally {
    g.running = false;
  }
}

export function startClaudeAutoPing() {
  if (g.interval) return;
  g.interval = setInterval(() => { tick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}
