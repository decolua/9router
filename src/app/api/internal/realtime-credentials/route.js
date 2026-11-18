import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getProviderConnections } from "@/lib/localDb";
import { extractApiKey, getProviderCredentials, markAccountUnavailable } from "@/sse/services/auth.js";
import { enforceKeyAccessResolved } from "@/sse/services/keyAccess.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { isRealtimeInternalRequest } from "@/lib/realtime/internal.js";
import realtimeModels from "../../../../../realtime/realtime-models.cjs";
import { resolvePollinationsModels } from "open-sse/services/pollinationsModels.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REALTIME_MODELS = new Set(realtimeModels);

function reply(status) {
  return new Response(null, { status, headers: { "Cache-Control": "no-store" } });
}

function hasProxyEnvironment() {
  return ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
    .some((key) => process.env[key]?.trim());
}

async function requiresProxy(data) {
  const proxy = await resolveConnectionProxyConfig(data);
  return proxy.source === "error" || proxy.strictProxy === true || proxy.connectionProxyEnabled === true ||
    proxy.connectionProxyUrl || proxy.vercelRelayUrl || proxy.proxyPoolId;
}

export async function POST(request) {
  if (!isRealtimeInternalRequest(request)) return reply(404);

  let model, validateOnly, excluded, failure, connectionId, apiKey;
  try {
    ({ model, validateOnly, excluded, failure, connectionId, apiKey } = await request.json());
  } catch {
    return reply(400);
  }
  const provider = typeof model === "string" && model.startsWith("pollinations/") ? "pollinations" : "openai";
  const upstreamModel = provider === "pollinations" ? model.slice(13) : model;
  if (provider === "openai" ? !REALTIME_MODELS.has(model) : !/^[a-z0-9][a-z0-9._/-]{0,199}$/i.test(upstreamModel)) return reply(400);

  const record = await getApiKeyByKey(extractApiKey(request));
  if (!record?.isActive) return reply(401);
  const context = record.access?.restricted
    ? { keyId: record.id, keyName: record.name || record.id, allow: record.access.allow || [], _sets: null }
    : null;
  const denied = await enforceKeyAccessResolved(context, `${provider}/${upstreamModel}`, provider, upstreamModel);
  if (denied) return denied;
  if (validateOnly === true) {
    if (typeof connectionId !== "string" || typeof apiKey !== "string" || !apiKey || hasProxyEnvironment()) return reply(403);
    const connection = (await getProviderConnections({ provider, isActive: true }))
      .find(item => item.id === connectionId && item.isActive && item.apiKey === apiKey);
    if (!connection || await requiresProxy(connection.providerSpecificData)) return reply(403);
    return reply(204);
  }

  // ponytail: cap retries at 100 accounts; use a server-side attempt store if larger pools are needed.
  if (excluded !== undefined && (!Array.isArray(excluded) || excluded.length > 100 || excluded.some(id => typeof id !== "string" || !id || id.length > 200))) return reply(400);
  const excludedIds = new Set(excluded || []);
  if (failure) {
    if (!excludedIds.has(failure.connectionId) || !Number.isInteger(failure.status) || failure.status < 400 || failure.status > 599) return reply(400);
    if (!(await getProviderConnections({ provider })).some(connection => connection.id === failure.connectionId)) return reply(400);
    const outcome = await markAccountUnavailable(failure.connectionId, failure.status, "Realtime upstream handshake failed", provider, upstreamModel);
    if (!outcome.shouldFallback) return reply(503);
  }
  if (hasProxyEnvironment()) return reply(503);
  let credentials;
  while (true) {
    credentials = await getProviderCredentials(provider, excludedIds, upstreamModel);
    if (!credentials?.apiKey || !credentials.connectionId || credentials.allRateLimited || excludedIds.has(credentials.connectionId)) return reply(503);
    if (!await requiresProxy(credentials._connection?.providerSpecificData || credentials.providerSpecificData)) break;
    excludedIds.add(credentials.connectionId);
  }
  if (provider === "pollinations") {
    try {
      const { models } = await resolvePollinationsModels(credentials);
      if (!models.some(entry => entry.id === upstreamModel && entry.kind === "realtime")) return reply(400);
    } catch { return reply(503); }
  }

  return Response.json(
    { apiKey: credentials.apiKey, connectionId: credentials.connectionId },
    { headers: { "Cache-Control": "no-store" } },
  );
}