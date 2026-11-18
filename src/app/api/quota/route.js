// GET /api/quota — machine-readable quota view for all provider connections.
//
// Reuses the exact per-connection pipeline the dashboard Provider Limits page
// uses (src/app/api/usage/[connectionId]/route.js + open-sse usage handlers).
//
// Access model (set per 9Router API key on the Endpoint page, `quotaAccess`):
//   * "none"                 — (default) key may not call /api/quota (403).
//   * "full"                 — connection name/email and real quota numbers.
//   * "anonymized-account"   — per-connection rows with stable one-way labels
//                              (conn-<hash>) instead of name/email.
//   * "anonymized-aggregate" — as anonymized-account, plus connections sharing
//                              a provider are merged into one aggregate row per
//                              provider when every member has numeric
//                              used/total; unaggregatable members stay as
//                              labeled per-connection rows.
//
// Auth: dashboard session JWT or CLI token (dashboard paths) → full view.
// Remote callers authenticate with a 9Router API key (Bearer / x-api-key /
// x-goog-api-key / ?key=); the key's quotaAccess selects the output mode.
//
// A RESTRICTED key (access.allow) only sees quota for the providers its
// allowlist routes to — listed model entries contribute their provider, listed
// combos contribute each member's provider, and a bare provider-as-model entry
// (search/fetch) contributes that provider. Anything else is filtered out.
import "open-sse/index.js";

import { getProviderConnections, getApiKeyByKey, getSettings } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";
import { expandKeyAccessAllow, extractClientApiKey } from "@/sse/services/keyAccess.js";
import { getModelInfo, getComboModels } from "@/sse/services/model.js";
import {
  QUOTA_ACCESS_NONE,
  QUOTA_ACCESS_FULL,
  QUOTA_ACCESS_ACCOUNT,
  QUOTA_ACCESS_AGGREGATE,
  anonymizeConnectionLabel,
} from "@/shared/utils/quotaAccess";

export const dynamic = "force-dynamic";

const lower = (s) => String(s).toLowerCase();

/**
 * Canonical provider ids a restricted key's allowlist grants. Mirrors the
 * resolution rules in src/sse/services/keyAccess.js (getAllowSets): exact
 * combo names (case-insensitive), resolved provider/model entries, and bare
 * provider-as-model entries.
 * @returns {Promise<Set<string>|null>} null when the key is unrestricted.
 */
async function getAllowedProvidersForKey(keyRecord) {
  if (!keyRecord?.access?.restricted) return null;
  const allowed = new Set();
  for (const entry of await expandKeyAccessAllow(keyRecord.access.allow)) {
    const comboModels = await getComboModels(entry);
    if (comboModels) {
      for (const member of comboModels) {
        const info = await getModelInfo(member);
        if (info?.provider) allowed.add(lower(info.provider));
      }
      continue;
    }
    const info = await getModelInfo(entry);
    if (info?.provider) allowed.add(lower(info.provider));
    // Provider-as-model (search/fetch): the allow entry IS the provider.
    if (!entry.includes("/")) allowed.add(lower(resolveProviderId(entry)));
  }
  return allowed;
}

/**
 * Aggregation for "anonymized-aggregate" mode. Connections sharing a provider
 * merge into one row per provider when every member carries numeric
 * used/total for all quota keys; unaggregatable groups (single member,
 * missing numbers) stay as labeled per-connection rows. Nothing
 * user-identifying escapes in either branch.
 */
function aggregateQuotas(rows) {
  const byProvider = new Map();
  for (const row of rows) {
    if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
    byProvider.get(row.provider).push(row);
  }
  const aggregates = [];
  const fallbacks = [];
  for (const [provider, members] of byProvider) {
    if (members.length < 2) { fallbacks.push(...members); continue; }
    // Every row in a group must carry numeric totals for "used"/"total" keys.
    const quotaKeys = new Set();
    for (const m of members) {
      for (const k of Object.keys(m.quotas || {})) quotaKeys.add(k);
    }
    if (quotaKeys.size === 0) { fallbacks.push(...members); continue; }

    const agg = {};
    let aggregatable = true;
    for (const k of quotaKeys) {
      let used = 0, total = 0;
      for (const m of members) {
        const q = m.quotas?.[k];
        if (!q || typeof q.used !== "number" || typeof q.total !== "number") { aggregatable = false; break; }
        used += q.used; total += q.total;
      }
      if (!aggregatable) break;
      agg[k] = { used, total };
    }
    if (!aggregatable) { fallbacks.push(...members); continue; }

    aggregates.push({
      provider,
      label: `${provider} (${members.length})`,
      connections: members.length,
      quotas: agg,
      resetAt: members.map((m) => m.resetAt).find(Boolean) || null,
    });
  }
  return { aggregates, fallbacks };
}

function anonymizeConnection(connection, machineId) {
  return {
    id: anonymizeConnectionLabel(connection, machineId),
    provider: connection.provider,
    name: anonymizeConnectionLabel(connection, machineId),
    email: null,
  };
}

function pct(used, total) {
  if (total === 0 || total === null || total === undefined) return null;
  return Math.round(((total - used) / total) * 100);
}

async function fetchConnectionQuota(connection, machineId, { anonymized, force }) {
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth = connection.authType === "apikey" || connection.authType === "api_key";
  const isApikeyEligible = isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);
  if (!isOAuth && !isApikeyEligible) return null;

  let proxyOptions = null;
  try {
    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };
  } catch {}

  let conn = connection;
  try {
    if (isOAuth) {
      const result = await refreshAndUpdateCredentials(conn, false, proxyOptions);
      conn = result.connection;
    }
  } catch (err) {
    console.warn(`[Quota API] credential refresh failed for ${connection.provider}-${connection.id}: ${err?.message}`);
    return null;
  }

  try {
    const usage = await getUsageForProvider(conn, proxyOptions, { force });
    if (!usage || typeof usage !== "object") return null;
    if (usage.message && !usage.quotas) return null; // provider not implemented / auth expired

    const quotas = {};
    for (const [quotaName, q] of Object.entries(usage.quotas || {})) {
      if (q && typeof q === "object" && typeof q.used === "number" && typeof q.total === "number") {
        quotas[quotaName] = {
          used: q.used,
          total: q.total,
          remaining: q.total - q.used,
          remainingPercentage: pct(q.used, q.total),
          resetAt: q.resetAt ?? q.resets_at ?? q.resetTime ?? q.window?.resetAt ?? null,
        };
      }
    }

    const identity = anonymized ? anonymizeConnection(connection, machineId) : {
      id: connection.id,
      provider: connection.provider,
      name: connection.name || null,
      email: connection.email || null,
    };

    return {
      ...identity,
      authType: connection.authType,
      isActive: connection.isActive !== false,
      plan: usage.plan ?? null,
      message: null,
      downloadedAt: new Date().toISOString(),
      quotas,
      rawMessage: usage.message ?? null,
    };
  } catch (err) {
    console.warn(`[Quota API] fetch failed for ${connection.provider}-${connection.id}: ${err?.message}`);
    return null;
  }
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get("force") === "1";

    // Mode comes from the presented 9Router API key. A presented key must
    // resolve to a real, active key record — an unknown or inactive key gets
    // 401. No key at all means a local/CLI/dashboard caller already authorized
    // by the middleware → full view. A key whose quotaAccess is "none" (the
    // default) is denied outright.
    let mode = QUOTA_ACCESS_FULL;
    let allowedProviders = null;
    const clientKey = extractClientApiKey(request);
    if (clientKey) {
      const keyRecord = await getApiKeyByKey(clientKey);
      if (!keyRecord || keyRecord.isActive === false) {
        return Response.json({ error: "Invalid API key" }, { status: 401 });
      }
      if (keyRecord.quotaAccess === QUOTA_ACCESS_NONE) {
        return Response.json({ error: "Quota access is disabled for this API key" }, { status: 403 });
      }
      mode = keyRecord.quotaAccess || QUOTA_ACCESS_NONE;
      allowedProviders = await getAllowedProvidersForKey(keyRecord);
    }

    const anonymized = mode === QUOTA_ACCESS_ACCOUNT || mode === QUOTA_ACCESS_AGGREGATE;
    const machineId = await getConsistentMachineId("9r-quota-anon");
    const allConnections = await getProviderConnections();
    const connections = allowedProviders
      ? allConnections.filter((c) => allowedProviders.has(lower(resolveProviderId(c.provider))))
      : allConnections;

    const results = [];
    const errors = [];
    for (const connection of connections) {
      const res = await fetchConnectionQuota(connection, machineId, { anonymized, force });
      if (res) results.push(res);
      else errors.push({ provider: connection.provider, connectionId: anonymized ? anonymizeConnectionLabel(connection, machineId) : connection.id, error: "unavailable" });
    }

    let payload;
    if (mode === QUOTA_ACCESS_AGGREGATE) {
      const { aggregates, fallbacks } = aggregateQuotas(results);
      payload = { mode, aggregated: aggregates, connections: fallbacks, errors };
    } else if (mode === QUOTA_ACCESS_ACCOUNT) {
      payload = { mode, aggregated: [], connections: results, errors };
    } else {
      const settings = await getSettings();
      payload = { mode: QUOTA_ACCESS_FULL, aggregated: [], connections: results, errors, quotaVisibility: settings?.quotaVisibility || {} };
    }

    return Response.json(payload);
  } catch (error) {
    console.error("[Quota API] error:", error);
    return Response.json({ error: "Failed to fetch quota" }, { status: 500 });
  }
}
