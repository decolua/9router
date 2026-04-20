import { NextResponse } from "next/server";
import { createProxyPool, getProviderConnections, getProxyPools } from "@/models";

function toBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const VALID_PROXY_TYPES = ["http", "vercel"];

function normalizeProxyPoolInput(body = {}) {
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const proxyUrl = typeof body?.proxyUrl === "string" ? body.proxyUrl.trim() : "";
  const noProxy = typeof body?.noProxy === "string" ? body.noProxy.trim() : "";
  const isActive = body?.isActive === undefined ? true : body.isActive === true;
  const strictProxy = body?.strictProxy === true;
  const type = VALID_PROXY_TYPES.includes(body?.type) ? body.type : "http";

  if (!name) {
    return { error: "Name is required" };
  }

  if (!proxyUrl) {
    return { error: "Proxy URL is required" };
  }

  return { name, proxyUrl, noProxy, isActive, strictProxy, type };
}

function buildUsageMap(connections = []) {
  const usageMap = new Map();

  for (const connection of connections) {
    const psd = connection?.providerSpecificData || {};
    const connectionName = connection.name || connection.email || connection.displayName || `Conn ${connection.id.slice(0, 8)}`;

    // Check legacy single proxyPoolId
    if (psd.proxyPoolId) {
      const entry = usageMap.get(psd.proxyPoolId) || { count: 0, names: [] };
      usageMap.set(psd.proxyPoolId, {
        count: entry.count + 1,
        names: [...entry.names, connectionName]
      });
    }

    // Check new proxyPoolIds array
    if (Array.isArray(psd.proxyPoolIds)) {
      for (const poolId of psd.proxyPoolIds) {
        if (poolId) {
          const entry = usageMap.get(poolId) || { count: 0, names: [] };
          usageMap.set(poolId, {
            count: entry.count + 1,
            names: [...entry.names, connectionName]
          });
        }
      }
    }
  }

  return usageMap;
}

// GET /api/proxy-pools - List proxy pools
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = toBoolean(searchParams.get("isActive"));
    const includeUsage = searchParams.get("includeUsage") === "true";

    const filter = {};
    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const proxyPools = await getProxyPools(filter);

    if (!includeUsage) {
      return NextResponse.json({ proxyPools });
    }

    const connections = await getProviderConnections();
    const usageMap = buildUsageMap(connections);

    const enrichedProxyPools = proxyPools.map((pool) => {
      const usage = usageMap.get(pool.id) || { count: 0, names: [] };
      return {
        ...pool,
        boundConnectionCount: usage.count,
        boundConnectionNames: usage.names.slice(0, 5),
        boundConnectionCountTotal: usage.names.length,
      };
    });

    return NextResponse.json({ proxyPools: enrichedProxyPools });
  } catch (error) {
    console.log("Error fetching proxy pools:", error);
    return NextResponse.json({ error: "Failed to fetch proxy pools" }, { status: 500 });
  }
}

// POST /api/proxy-pools - Create proxy pool
export async function POST(request) {
  try {
    const body = await request.json();
    const normalized = normalizeProxyPoolInput(body);

    if (normalized.error) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    const proxyPool = await createProxyPool(normalized);
    return NextResponse.json({ proxyPool }, { status: 201 });
  } catch (error) {
    console.log("Error creating proxy pool:", error);
    return NextResponse.json({ error: "Failed to create proxy pool" }, { status: 500 });
  }
}
