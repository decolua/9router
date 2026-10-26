import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { toProviderConnectionResponse } from "@/lib/providerConnectionResponse";
import {
  OPENAI_COMPATIBLE_PREFIX,
  ANTHROPIC_COMPATIBLE_PREFIX,
  CUSTOM_EMBEDDING_PREFIX,
} from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

// Resolve a compatible-node value that may be EITHER the generated node id
// (openai-compatible-chat-<uuid>) or one of the user-facing prefix forms —
// the bare user prefix ("pfx") or the kind-qualified one ("openai-compatible-pfx"),
// the same shape prefixed model URLs use. Automation users naturally send the
// prefix form, but the original code SELECTed by id only and 404'd a bare
// "node not found" (DF-9ROUTER-63). Order: exact id first (backward
// compatible), then prefix match among nodes of this kind.
const COMPATIBLE_NODE_KINDS = [
  { prefix: OPENAI_COMPATIBLE_PREFIX, type: "openai-compatible" },
  { prefix: ANTHROPIC_COMPATIBLE_PREFIX, type: "anthropic-compatible" },
  { prefix: CUSTOM_EMBEDDING_PREFIX, type: "custom-embedding" },
];

async function resolveCompatibleNode(rawValue, kindPrefix) {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) return null;

  // 1. Exact node id — the historical contract, unchanged.
  const direct = await getProviderNodeById(value);
  if (direct) return direct;

  const kind = COMPATIBLE_NODE_KINDS.find((k) => k.prefix === kindPrefix);

  // 2. Prefix forms. A prefix match must hit a node of the matching kind, so
  //    an id-shaped miss can never alias onto an unrelated node's prefix.
  const candidates = new Set();
  candidates.add(value.startsWith(kindPrefix) ? value.slice(kindPrefix.length) : value);
  candidates.add(value);

  const nodes = await getProviderNodes();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = nodes.find((n) => n.prefix === candidate && (!kind || n.type === kind.type));
    if (match) return match;
  }
  return null;
}

function compatibleNodeNotFoundMessage(kindPrefix) {
  return (
    `Compatible node not found. The provider value must be either the generated node id ` +
    `(as returned by POST /api/provider-nodes) or the node's user-chosen prefix — ` +
    `both "<prefix>" and "${kindPrefix}<prefix>" forms are accepted. List nodes at GET /api/provider-nodes.`
  );
}

function normalizeProxyConfig(body = {}) {
  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled" };
  }

  return {
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolId(proxyPoolId) {
  if (proxyPoolId === undefined || proxyPoolId === null || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { proxyPoolId: null };
  }

  const normalizedId = String(proxyPoolId).trim();
  if (!normalizedId) {
    return { proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(normalizedId);
  if (!proxyPool) {
    return { error: "Proxy pool not found" };
  }

  return { proxyPoolId: normalizedId };
}

// GET /api/providers - List all connections
export async function GET() {
  try {
    const connections = await getProviderConnections();

    // Build nodeNameMap for compatible providers (id → name)
    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch { }

    // Hide sensitive fields, enrich name for compatible providers
    const safeConnections = connections.map(c => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      return {
        ...toProviderConnectionResponse(c),
        name,
      };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, name, displayName, priority, globalPriority, defaultModel, testStatus } = body;
    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolId(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    const proxyPoolId = proxyPoolResult.proxyPoolId;

    // Validation
    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];
    // Dual-auth providers (e.g. codebuddy-cn, xai) live under category "oauth" but also
    // accept an API key via authModes — they aren't in APIKEY_PROVIDERS, so allow them here.
    const supportsApiKeyMode = !!AI_PROVIDERS[provider]?.authModes?.includes("apikey");
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
      FREE_TIER_PROVIDERS[provider] ||
      supportsApiKeyMode ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    // A provider may declare a providerSpecificData field that stands in for an API key — e.g.
    // Bedrock's `profile`, where the credential lives in the local AWS config and there is no
    // key to paste. Without this, following such a provider's own setup notice returns 400.
    const apiKeySubstitute = AI_PROVIDERS[provider]?.apiKeyOptionalWith;
    const hasApiKeySubstitute = !!(apiKeySubstitute && body.providerSpecificData?.[apiKeySubstitute]);
    if (!apiKey && provider !== "ollama-local" && !hasApiKeySubstitute) {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }
    const connectionName = name || displayName || AI_PROVIDERS[provider]?.name;
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);

    // Compatible LLM nodes support multiple API-key connections (key pool); runtime
    // rotates/fails over via getProviderCredentials. Embedding nodes stay single-connection.
    // A prefix-form provider value is rewritten to the node id: every downstream
    // consumer (chat provider resolution, credential lookup) keys on the id.
    let connectionProvider = provider;
    if (isOpenAICompatibleProvider(provider)) {
      const node = await resolveCompatibleNode(provider, OPENAI_COMPATIBLE_PREFIX);
      if (!node) {
        return NextResponse.json({ error: compatibleNodeNotFoundMessage(OPENAI_COMPATIBLE_PREFIX) }, { status: 404 });
      }
      connectionProvider = node.id;
      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await resolveCompatibleNode(provider, ANTHROPIC_COMPATIBLE_PREFIX);
      if (!node) {
        return NextResponse.json({ error: compatibleNodeNotFoundMessage(ANTHROPIC_COMPATIBLE_PREFIX) }, { status: 404 });
      }
      connectionProvider = node.id;
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await resolveCompatibleNode(provider, CUSTOM_EMBEDDING_PREFIX);
      if (!node) {
        return NextResponse.json({ error: compatibleNodeNotFoundMessage(CUSTOM_EMBEDDING_PREFIX) }, { status: 404 });
      }
      connectionProvider = node.id;
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    const mergedProviderSpecificData = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy,
    };

    if (proxyPoolId !== null) {
      mergedProviderSpecificData.proxyPoolId = proxyPoolId;
    }

    const newConnection = await createProviderConnection({
      provider: connectionProvider,
      authType: isWebCookieProvider ? "cookie" : "apikey",
      name: connectionName,
      apiKey: apiKey || "",
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedProviderSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
      // POST with an id is an explicit edit of that connection; without one, a
      // name collision is refused rather than silently overwriting a key. #4311
      allowOverwrite: body.id ? true : (body.allowOverwrite === true || body.overwrite === true),
    });

    return NextResponse.json(
      { connection: toProviderConnectionResponse(newConnection) },
      { status: 201 },
    );
  } catch (error) {
    if (error?.code === "PROVIDER_NAME_CONFLICT") {
      return NextResponse.json(
        { error: error.message, code: error.code, existingId: error.existingId, existingName: error.existingName },
        { status: 409 }
      );
    }
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
