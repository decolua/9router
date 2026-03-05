import { NextResponse } from "next/server";
import {
  createProxyPool,
  getProviderConnections,
  getProxyPools,
  updateProviderConnection,
} from "@/models";

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function buildProxyKey(proxyUrl, noProxy) {
  return `${normalizeString(proxyUrl)}|||${normalizeString(noProxy)}`;
}

function extractLegacyProxy(connection) {
  const providerSpecificData = connection?.providerSpecificData || {};
  const connectionProxyEnabled = providerSpecificData.connectionProxyEnabled === true;
  const connectionProxyUrl = normalizeString(providerSpecificData.connectionProxyUrl);
  const connectionNoProxy = normalizeString(providerSpecificData.connectionNoProxy);

  if (!connectionProxyEnabled || !connectionProxyUrl) {
    return null;
  }

  return {
    connectionProxyUrl,
    connectionNoProxy,
  };
}

function buildMigratedName(index) {
  return `Migrated Proxy ${index}`;
}

// POST /api/proxy-pools/migrate - Migrate legacy connection proxy config into proxy pools
export async function POST() {
  try {
    const connections = await getProviderConnections();
    const existingPools = await getProxyPools();

    const poolByKey = new Map();
    for (const pool of existingPools) {
      const key = buildProxyKey(pool.proxyUrl, pool.noProxy);
      if (!poolByKey.has(key)) {
        poolByKey.set(key, pool);
      }
    }

    let migratedConnectionCount = 0;
    let legacyConnectionCount = 0;
    const createdPools = [];

    for (const connection of connections) {
      const legacyProxy = extractLegacyProxy(connection);
      if (!legacyProxy) continue;

      legacyConnectionCount += 1;
      const key = buildProxyKey(legacyProxy.connectionProxyUrl, legacyProxy.connectionNoProxy);

      let pool = poolByKey.get(key);
      if (!pool) {
        pool = await createProxyPool({
          name: buildMigratedName(existingPools.length + createdPools.length + 1),
          proxyUrl: legacyProxy.connectionProxyUrl,
          noProxy: legacyProxy.connectionNoProxy,
          isActive: true,
          testStatus: "unknown",
        });
        createdPools.push(pool);
        poolByKey.set(key, pool);
      }

      if (connection?.providerSpecificData?.proxyPoolId !== pool.id) {
        await updateProviderConnection(connection.id, {
          providerSpecificData: {
            ...(connection.providerSpecificData || {}),
            proxyPoolId: pool.id,
          },
        });
        migratedConnectionCount += 1;
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        totalConnections: connections.length,
        legacyConnections: legacyConnectionCount,
        poolsCreated: createdPools.length,
        connectionsBound: migratedConnectionCount,
      },
      createdPools,
    });
  } catch (error) {
    console.log("Error migrating proxy pools:", error);
    return NextResponse.json({ error: "Failed to migrate proxy pools" }, { status: 500 });
  }
}
