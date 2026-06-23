import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { createProxyPool, getProviderConnections, getProxyPools } from "@/models";

type JsonObject = { [key: string]: JsonValue };

function toBoolean(value: string | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const VALID_PROXY_TYPES = ["http", "vercel", "cloudflare", "deno"] as const;
type ProxyType = typeof VALID_PROXY_TYPES[number];

interface NormalizedPool {
  name: string;
  proxyUrl: string;
  noProxy: string;
  isActive: boolean;
  strictProxy: boolean;
  type: ProxyType;
}

interface NormalizeError {
  error: string;
}

interface CreatePoolBody {
  name?: JsonValue;
  proxyUrl?: JsonValue;
  noProxy?: JsonValue;
  isActive?: JsonValue;
  strictProxy?: JsonValue;
  type?: JsonValue;
}

function normalizeProxyPoolInput(body: CreatePoolBody) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const proxyUrl = typeof body.proxyUrl === "string" ? body.proxyUrl.trim() : "";
  const noProxy = typeof body.noProxy === "string" ? body.noProxy.trim() : "";
  const isActive = body.isActive === undefined ? true : body.isActive === true;
  const strictProxy = body.strictProxy === true;
  const type: ProxyType = VALID_PROXY_TYPES.includes(body.type as ProxyType) ? (body.type as ProxyType) : "http";

  if (!name) return { error: "Name is required" };
  if (!proxyUrl) return { error: "Proxy URL is required" };

  return { name, proxyUrl, noProxy, isActive, strictProxy, type };
}

function buildUsageMap(connections: ProviderConnection[]) {
  const usageMap = new Map<string, number>();

  for (const connection of connections) {
    const psd = connection["providerSpecificData"];
    if (psd === null || typeof psd !== "object") continue;
    const proxyPoolId = (psd as JsonObject)["proxyPoolId"];
    if (typeof proxyPoolId !== "string") continue;
    usageMap.set(proxyPoolId, (usageMap.get(proxyPoolId) ?? 0) + 1);
  }

  return usageMap;
}

// GET /api/proxy-pools - List proxy pools
export async function GET(request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  try {
    const { searchParams } = new URL(request.url);
    const isActive = toBoolean(searchParams.get("isActive"));
    const includeUsage = searchParams.get("includeUsage") === "true";

    const filter: { isActive?: boolean } = {};
    if (isActive !== undefined) filter.isActive = isActive;

    const proxyPools = await getProxyPools(filter);

    if (!includeUsage) {
      return NextResponse.json({ proxyPools });
    }

    const connections = await getProviderConnections();
    const usageMap = buildUsageMap(connections);

    const enrichedProxyPools = proxyPools.map((pool) => ({
      ...pool,
      boundConnectionCount: usageMap.get(pool.id) ?? 0,
    }));

    return NextResponse.json({ proxyPools: enrichedProxyPools });
  } catch (error) {
    console.log("Error fetching proxy pools:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pools" }, { status: 500 });
  }
}

// POST /api/proxy-pools - Create proxy pool
export async function POST(request: NextRequest, context: { params: Promise<{}> }) {
  await context.params;
  try {
    const body = await request.json() as CreatePoolBody;
    const normalized = normalizeProxyPoolInput(body);

    if ("error" in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const proxyPool = await createProxyPool(normalized);
    return NextResponse.json({ proxyPool }, { status: 201 });
  } catch (error) {
    console.log("Error creating proxy pool:", error);
    return NextResponse.json({ error: "Failed to create proxy pool" }, { status: 500 });
  }
}
