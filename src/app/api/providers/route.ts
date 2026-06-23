import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import type { ProviderNode } from "@/lib/db/repos/nodesRepo";
import {
  getProviderConnections,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/lib/localDb";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import { validateSearxngBaseUrl } from "open-sse/handlers/search/searxngUrlGuard.js";

export const dynamic = "force-dynamic";

function normalizeProxyConfig(body: {
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
}) {
  const enabled = body.connectionProxyEnabled === true;
  const url = typeof body.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";
  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled" as const };
  }
  return { connectionProxyEnabled: enabled, connectionProxyUrl: url, connectionNoProxy: noProxy };
}

async function normalizeProxyPoolId(proxyPoolId: string | null | undefined) {
  if (proxyPoolId === undefined || proxyPoolId === null || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { proxyPoolId: null };
  }
  const normalizedId = String(proxyPoolId).trim();
  if (!normalizedId) return { proxyPoolId: null };
  const proxyPool = await getProxyPoolById(normalizedId);
  if (!proxyPool) return { error: "Proxy pool not found" as const, proxyPoolId: null };
  return { proxyPoolId: normalizedId };
}

// GET /api/providers - List all connections
export async function GET(request: NextRequest, context: { params: Promise<{}> }) {
  try {
    const {} = await context.params;
    const connections = await getProviderConnections() as ProviderConnection[];

    const nodeNameMap: Record<string, string> = {};
    try {
      const nodes = await getProviderNodes() as ProviderNode[];
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch { }

    const safeConnections = connections.map((c) => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const psd = c.providerSpecificData as { nodeName?: string } | undefined;
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider] || psd?.nodeName || c.provider)
        : c.name;
      return { ...c, name, apiKey: undefined, accessToken: undefined, refreshToken: undefined, idToken: undefined };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

// POST /api/providers - Create new connection (API Key only, OAuth via separate flow)
export async function POST(request: NextRequest, context: { params: Promise<{}> }) {
  try {
    const {} = await context.params;
    const body = await request.json() as {
      provider?: string;
      apiKey?: string;
      name?: string;
      displayName?: string;
      priority?: number;
      globalPriority?: number | null;
      defaultModel?: string | null;
      testStatus?: string;
      proxyPoolId?: string | null;
      connectionProxyEnabled?: boolean;
      connectionProxyUrl?: string;
      connectionNoProxy?: string;
      providerSpecificData?: Record<string, JsonValue>;
      baseUrl?: string;
      searxngBaseUrl?: string;
    };
    const { apiKey, name, displayName, priority, globalPriority, defaultModel, testStatus } = body;

    const provider = normalizeProviderId(body.provider ?? "");
    const proxyConfig = normalizeProxyConfig(body);
    if ("error" in proxyConfig) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolId(body.proxyPoolId);
    if ("error" in proxyPoolResult) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    const { proxyPoolId } = proxyPoolResult;

    const aiProviders = AI_PROVIDERS as Record<string, { noAuth?: boolean; name?: string }>;
    const isWebCookieProvider = !!(WEB_COOKIE_PROVIDERS as Record<string, boolean>)[provider];
    const isNoAuthProvider = aiProviders[provider]?.noAuth === true;
    const isValidProvider =
      (APIKEY_PROVIDERS as Record<string, boolean>)[provider] ||
      (FREE_TIER_PROVIDERS as Record<string, boolean>)[provider] ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    if (!apiKey && provider !== "ollama-local" && !isNoAuthProvider) {
      return NextResponse.json({ error: `${isWebCookieProvider ? "Cookie value" : "API Key"} is required` }, { status: 400 });
    }

    if (provider === "searxng") {
      const psd = body.providerSpecificData;
      const rawBaseUrl = (psd?.baseUrl as string | undefined) ?? body.baseUrl ?? body.searxngBaseUrl ?? "";
      if (rawBaseUrl) {
        const guard = validateSearxngBaseUrl(rawBaseUrl);
        if (!guard.ok) {
          return NextResponse.json({ error: `Invalid SearXNG base URL: ${guard.error}` }, { status: 400 });
        }
      }
    }

    const connectionName = name || displayName || aiProviders[provider]?.name;
    if (!connectionName) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData as null | undefined);

    if (isOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider) as ProviderNode | null;
      if (!node) return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      const existing = await getProviderConnections({ provider });
      if (existing.length > 0) return NextResponse.json({ error: "Only one connection is allowed for this OpenAI Compatible node" }, { status: 400 });
      providerSpecificData = { prefix: node.prefix, apiType: node.apiType, baseUrl: node.baseUrl, nodeName: node.name };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider) as ProviderNode | null;
      if (!node) return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      const existing = await getProviderConnections({ provider });
      if (existing.length > 0) return NextResponse.json({ error: "Only one connection is allowed for this Anthropic Compatible node" }, { status: 400 });
      providerSpecificData = { prefix: node.prefix, baseUrl: node.baseUrl, nodeName: node.name };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider) as ProviderNode | null;
      if (!node) return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      const existing = await getProviderConnections({ provider });
      if (existing.length > 0) return NextResponse.json({ error: "Only one connection is allowed for this Custom Embedding node" }, { status: 400 });
      providerSpecificData = { prefix: node.prefix, baseUrl: node.baseUrl, nodeName: node.name };
    }

    const mergedPsd: Record<string, JsonValue | undefined> = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy,
    };
    if (proxyPoolId !== null) mergedPsd.proxyPoolId = proxyPoolId;

    const newConnection = await createProviderConnection({
      provider,
      authType: isWebCookieProvider ? "cookie" : "apikey",
      name: connectionName,
      apiKey: apiKey || "",
      priority: priority || 1,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedPsd,
      isActive: true,
      testStatus: testStatus || "unknown",
    });

    const result = { ...newConnection };
    delete result.apiKey;

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
