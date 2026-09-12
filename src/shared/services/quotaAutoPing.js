import "open-sse/index.js";

import { getSettings, getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { getClaudeUsage } from "open-sse/services/usage/claude.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { getExecutor } from "open-sse/executors/index.js";
import { CLAUDE_CLI_SPOOF_HEADERS } from "open-sse/providers/shared.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";
import {
  getStaggerGroup,
  isStaggerAutoPingEnabled,
  updateStaggerState,
  getStaggerDecision,
  markStaggerPing,
  hasQuotaAutoPingEnabled,
} from "@/shared/services/quotaStagger.js";

const C = QUOTA_AUTOPING_CONFIG;
const CLAUDE_PING_URL = "https://api.anthropic.com/v1/messages?beta=true";

const providerHandlers = {
  claude: {
    getUsage: getClaudeUsage,
    sendPing: sendClaudePing,
  },
  codex: {
    getUsage: getCodexUsage,
    sendPing: sendCodexPing,
  },
};

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__quotaAutoPing ??= {
  interval: null,
  running: false,
  resetCache: {},
  failureCache: {},
});

function cacheKey(provider, connectionId) {
  return `${provider}:${connectionId}`;
}

function normalizeResetKey(resetAt) {
  const ms = new Date(resetAt).getTime();
  if (!Number.isFinite(ms)) return resetAt;
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
}

function getResetDriftMs(previousResetAt, nextResetAt) {
  const previousMs = new Date(previousResetAt).getTime();
  const nextMs = new Date(nextResetAt).getTime();
  if (!Number.isFinite(previousMs) || !Number.isFinite(nextMs)) return 0;
  return nextMs - previousMs;
}

function toFiniteNumber(value, fallback = null) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function isQuotaExhausted(quota) {
  if (!quota || quota.unlimited === true) return false;
  const remaining = toFiniteNumber(quota.remaining);
  if (remaining !== null) return remaining <= 0;

  const used = toFiniteNumber(quota.used);
  const total = toFiniteNumber(quota.total);
  return total !== null && total > 0 && used !== null && used >= total;
}

function wasPingedRecently(connection, intervalMs, nowMs = Date.now()) {
  if (!intervalMs) return false;
  const lastPingAtMs = new Date(connection.lastPingAt).getTime();
  return Number.isFinite(lastPingAtMs) && nowMs - lastPingAtMs < intervalMs;
}

function isBlockingQuotaName(name, sessionKey) {
  if (name === sessionKey) return false;
  return !String(name).toLowerCase().includes("session");
}

function hasExhaustedBlockingQuota(quotas, sessionKey) {
  return Object.entries(quotas || {}).some(([name, quota]) => isBlockingQuotaName(name, sessionKey) && isQuotaExhausted(quota));
}

function shouldPingForReset(providerConfig, cachedReset, resetAt, now) {
  if (providerConfig.pingWhenResetAtSlides) {
    return Boolean(cachedReset) && getResetDriftMs(cachedReset, resetAt) >= (providerConfig.resetAtDriftMs || 0);
  }

  const resetMs = new Date(resetAt).getTime();
  return Number.isFinite(resetMs) && now >= resetMs - C.pingLeadMs;
}

function buildProxyOptions(cfg) {
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

async function sendClaudePing(connection, providerConfig, proxyOptions, deps) {
  const res = await deps.proxyAwareFetch(CLAUDE_PING_URL, {
    method: "POST",
    headers: {
      ...CLAUDE_CLI_SPOOF_HEADERS,
      "Authorization": `Bearer ${connection.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: providerConfig.pingModel,
      max_tokens: providerConfig.pingMaxTokens,
      messages: [{ role: "user", content: providerConfig.pingText }],
    }),
  }, proxyOptions);
  return res.ok;
}

function buildCodexPingInput(text) {
  return [{
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  }];
}

async function drainResponseBody(response) {
  if (typeof response?.text === "function") {
    await response.text();
    return;
  }

  const reader = response?.body?.getReader?.();
  if (!reader) return;

  try {
    while (true) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function sendCodexPing(connection, providerConfig, proxyOptions, deps) {
  const executor = deps.getExecutor("codex");
  const { response } = await executor.execute({
    model: providerConfig.pingModel,
    stream: true,
    credentials: {
      accessToken: connection.accessToken,
      connectionId: connection.id,
      providerSpecificData: connection.providerSpecificData,
    },
    proxyOptions,
    log: console,
    body: {
      model: providerConfig.pingModel,
      input: buildCodexPingInput(providerConfig.pingText),
      instructions: providerConfig.pingInstructions,
      reasoning: providerConfig.pingReasoningEffort
        ? { effort: providerConfig.pingReasoningEffort, summary: "auto" }
        : undefined,
      store: false,
      stream: true,
    },
  });
  if (!response.ok) {
    try { await response.body?.cancel?.(); } catch { /* noop */ }
    return false;
  }

  // Codex only starts the 5h window after the streaming response completes.
  await drainResponseBody(response);
  return true;
}

function shouldSkipAfterFailure(state, key, nowMs = Date.now()) {
  const failedAt = state.failureCache[key];
  return failedAt && nowMs - failedAt < C.failureCooldownMs;
}

async function pingConnection(conn, provider, providerConfig, handler, deps, state = g, settings = null, allActiveConnections = null) {
  const key = cacheKey(provider, conn.id);

  if (shouldSkipAfterFailure(state, key)) return;

  const currentSettings = settings || (await deps.getSettings()) || {};
  const currentActiveConnections = allActiveConnections || (await deps.getProviderConnections({ isActive: true })) || [];

  const isStaggerFn = deps.isStaggerAutoPingEnabled || isStaggerAutoPingEnabled;
  const getGroupFn = deps.getStaggerGroup || getStaggerGroup;
  const updateStaggerStateFn = deps.updateStaggerState || updateStaggerState;
  const getStaggerDecisionFn = deps.getStaggerDecision || getStaggerDecision;
  const markStaggerPingFn = deps.markStaggerPing || markStaggerPing;

  const isGrouped = isStaggerFn(currentSettings, conn);
  const group = isGrouped ? getGroupFn(currentSettings, conn.id) : null;

  const cachedReset = state.resetCache[key];
  if (!isGrouped && !providerConfig.pingWhenResetAtSlides && cachedReset && Date.now() < new Date(cachedReset).getTime() - C.refreshAheadMs) {
    return;
  }

  const proxyCfg = await deps.resolveConnectionProxyConfig(conn.providerSpecificData);
  const proxyOptions = buildProxyOptions(proxyCfg);

  let connection = conn;
  try {
    const r = await deps.refreshAndUpdateCredentials(connection, false, proxyOptions);
    connection = r.connection;
  } catch (e) {
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${conn.id}: refresh failed: ${e.message}`);
    return;
  }

  let usage;
  try {
    usage = await handler.getUsage(connection.accessToken, proxyOptions);
  } catch (e) {
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${conn.id}: usage failed: ${e.message}`);
    return;
  }

  const quotas = usage?.quotas || {};

  if (isGrouped) {
    const nowMs = Date.now();
    const sampleObservedAtMs = usage?.observedAtMs || nowMs;

    const nextState = updateStaggerStateFn({
      connection,
      settings: currentSettings,
      connections: currentActiveConnections,
      quotas,
      nowMs,
      observedAtMs: sampleObservedAtMs,
    });

    if (nextState) {
      await deps.updateProviderConnection(connection.id, { quotaStaggerState: nextState });
      connection = { ...connection, quotaStaggerState: nextState };
    }

    const decision = getStaggerDecisionFn({
      connection,
      settings: currentSettings,
      connections: currentActiveConnections,
      nowMs,
    });

    const sessionQuota = quotas?.[providerConfig.quotaKey] || quotas?.session || quotas?.["session (5h)"];
    const weeklyQuota = quotas?.weekly || quotas?.["weekly (7d)"] || Object.entries(quotas).find(([k]) => k.toLowerCase().includes("weekly"))?.[1];

    if (!sessionQuota || !weeklyQuota) {
      return;
    }

    const resetAt = sessionQuota?.resetAt;
    if (resetAt) state.resetCache[key] = resetAt;

    if (decision.waiting) {
      return;
    }

    if (decision.ready) {
      if (shouldSkipAfterFailure(state, key, nowMs)) return;
      if (isQuotaExhausted(sessionQuota)) return;
      if (hasExhaustedBlockingQuota(quotas, providerConfig.quotaKey)) return;
      if (wasPingedRecently(connection, providerConfig.minPingIntervalMs, nowMs)) return;

      const resetKey = resetAt ? normalizeResetKey(resetAt) : null;
      const lastPingedResetKey = connection.lastPingedResetKey || (connection.lastPingedResetAt ? normalizeResetKey(connection.lastPingedResetAt) : null);
      const isSessionPending = Boolean(nextState?.pendingSlots?.session);
      if (isSessionPending && resetKey && lastPingedResetKey === resetKey) return;

      const latestSettings = await deps.getSettings();
      const latestActiveConnections = (await deps.getProviderConnections({ isActive: true })) || [];
      if (!isStaggerFn(latestSettings, connection)) return;

      const latestDecision = getStaggerDecisionFn({
        connection,
        settings: latestSettings,
        connections: latestActiveConnections,
        nowMs: Date.now(),
      });
      if (!latestDecision.ready) return;

      const ok = await handler.sendPing(connection, providerConfig, proxyOptions, deps);
      if (!ok) {
        state.failureCache[key] = Date.now();
        console.warn(`[AutoPing] ${provider}:${connection.id}: ping failed`);
        return;
      }

      delete state.failureCache[key];
      const pingedMs = Date.now();
      const updatedState = markStaggerPingFn(nextState, pingedMs);
      await deps.updateProviderConnection(connection.id, {
        lastPingedResetAt: resetAt || null,
        lastPingedResetKey: resetKey || "first-use",
        lastPingAt: new Date(pingedMs).toISOString(),
        updatedAt: new Date(pingedMs).toISOString(),
        quotaStaggerState: updatedState,
      });
      console.log(`[AutoPing] ${provider}:${connection.id}: stagger ping sent`);
      return;
    }

    const legacyToggleEnabled = currentSettings?.[providerConfig.settingsKey]?.connections?.[connection.id] === true;
    const sessionPolicyActive = group?.session?.enabled === true;
    const weeklyVerifiedActiveOrFixed = (nextState?.windowStatus?.weekly === "active" && (toFiniteNumber(weeklyQuota?.used) > 0 || toFiniteNumber(weeklyQuota?.utilization) > 0))
      || nextState?.windowStatus?.weekly === "fixed";

    if (!sessionPolicyActive && legacyToggleEnabled && weeklyVerifiedActiveOrFixed && resetAt) {
      if (hasExhaustedBlockingQuota(quotas, providerConfig.quotaKey)) return;
      if (isQuotaExhausted(sessionQuota)) return;

      const resetKey = normalizeResetKey(resetAt);
      const lastPingedResetKey = connection.lastPingedResetKey || normalizeResetKey(connection.lastPingedResetAt);

      if (!shouldPingForReset(providerConfig, cachedReset, resetAt, nowMs)) return;
      if (wasPingedRecently(connection, providerConfig.minPingIntervalMs, nowMs)) return;
      if (lastPingedResetKey === resetKey) return;

      const latestSettings = await deps.getSettings();
      const latestActiveConnections = (await deps.getProviderConnections({ isActive: true })) || [];
      if (isStaggerFn(latestSettings, connection)) {
        const latestGroup = getGroupFn(latestSettings, connection.id);
        if (latestGroup?.session?.enabled === true) return;
        const latestDecision = getStaggerDecisionFn({
          connection,
          settings: latestSettings,
          connections: latestActiveConnections,
          nowMs: Date.now(),
        });
        if (latestDecision.waiting) return;
      }
      if (latestSettings?.[providerConfig.settingsKey]?.connections?.[connection.id] !== true) return;

      const ok = await handler.sendPing(connection, providerConfig, proxyOptions, deps);
      if (!ok) {
        state.failureCache[key] = Date.now();
        console.warn(`[AutoPing] ${provider}:${connection.id}: ping failed (reset ${resetAt})`);
        return;
      }

      delete state.failureCache[key];
      await deps.updateProviderConnection(connection.id, {
        lastPingedResetAt: resetAt,
        lastPingedResetKey: resetKey,
        lastPingAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      console.log(`[AutoPing] ${provider}:${connection.id}: legacy ping sent (reset ${resetAt})`);
    }
    return;
  }

  const quota = quotas?.[providerConfig.quotaKey];
  const resetAt = quota?.resetAt;
  if (!resetAt) return;

  state.resetCache[key] = resetAt;

  if (providerConfig.skipWhenBlockingQuotaExhausted && hasExhaustedBlockingQuota(quotas, providerConfig.quotaKey)) return;
  if (isQuotaExhausted(quota)) return;

  const now = Date.now();
  const resetKey = normalizeResetKey(resetAt);
  const lastPingedResetKey = connection.lastPingedResetKey || normalizeResetKey(connection.lastPingedResetAt);

  if (!shouldPingForReset(providerConfig, cachedReset, resetAt, now)) return;
  if (wasPingedRecently(connection, providerConfig.minPingIntervalMs, now)) return;
  if (lastPingedResetKey === resetKey) return;

  const latestSettings = await deps.getSettings();
  const latestActiveConnections = (await deps.getProviderConnections({ isActive: true })) || [];
  if (isStaggerFn(latestSettings, connection)) {
    const latestDecision = getStaggerDecisionFn({
      connection,
      settings: latestSettings,
      connections: latestActiveConnections,
      nowMs: Date.now(),
    });
    if (!latestDecision.ready) return;
  }
  if (latestSettings?.[providerConfig.settingsKey]?.connections?.[connection.id] !== true) return;

  const ok = await handler.sendPing(connection, providerConfig, proxyOptions, deps);
  if (!ok) {
    state.failureCache[key] = Date.now();
    console.warn(`[AutoPing] ${provider}:${connection.id}: ping failed (reset ${resetAt})`);
    return;
  }

  delete state.failureCache[key];
  await deps.updateProviderConnection(connection.id, {
    lastPingedResetAt: resetAt,
    lastPingedResetKey: resetKey,
    lastPingAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  console.log(`[AutoPing] ${provider}:${connection.id}: ping sent (reset ${resetAt})`);
}

function createDefaultDeps() {
  return {
    getSettings,
    getProviderConnections,
    updateProviderConnection,
    resolveConnectionProxyConfig,
    refreshAndUpdateCredentials,
    proxyAwareFetch,
    getExecutor,
    getStaggerGroup,
    isStaggerAutoPingEnabled,
    updateStaggerState,
    getStaggerDecision,
    markStaggerPing,
  };
}

export async function runQuotaAutoPingTick(deps = createDefaultDeps(), state = g) {
  if (state.running) return;
  state.running = true;
  try {
    const settings = await deps.getSettings();

    if (!hasQuotaAutoPingEnabled(settings)) return;

    const allActiveConnections = (await deps.getProviderConnections({ isActive: true })) || [];
    const isStaggerFn = deps.isStaggerAutoPingEnabled || isStaggerAutoPingEnabled;

    for (const [provider, providerConfig] of Object.entries(C.providers)) {
      const handler = providerHandlers[provider];
      if (!handler) continue;

      const enabledMap = settings?.[providerConfig.settingsKey]?.connections || {};
      const providerConns = allActiveConnections.filter(
        (c) => c.provider === provider && c.authType === "oauth" && c.isActive !== false
      );
      const targets = providerConns.filter(
        (conn) => enabledMap[conn.id] === true || isStaggerFn(settings, conn)
      );

      for (const conn of targets) {
        try {
          await pingConnection(conn, provider, providerConfig, handler, deps, state, settings, allActiveConnections);
        } catch (e) {
          state.failureCache[cacheKey(provider, conn.id)] = Date.now();
          console.warn(`[AutoPing] ${provider}:${conn.id}: ${e.message}`);
        }
      }
    }
  } catch (e) {
    console.warn("[AutoPing] tick error:", e.message);
  } finally {
    state.running = false;
  }
}

export function startQuotaAutoPing() {
  if (g.interval) return;
  console.log("[AutoPing] scheduler started");
  runQuotaAutoPingTick().catch(() => {});
  g.interval = setInterval(() => { runQuotaAutoPingTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}

export function stopQuotaAutoPing() {
  if (!g.interval) return;
  clearInterval(g.interval);
  g.interval = null;
  console.log("[AutoPing] scheduler stopped");
}

export { hasQuotaAutoPingEnabled };

export function configureQuotaAutoPing(settings) {
  if (hasQuotaAutoPingEnabled(settings)) startQuotaAutoPing();
  else stopQuotaAutoPing();
}
