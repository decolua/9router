import { NextResponse } from "next/server";
import { getRequestDetailsDb } from "@/lib/requestDetailsDb";
import { getProviderNodes } from "@/lib/localDb";
import { withApiCache } from "@/lib/apiCache";
import { API_CACHE_KEYS } from "@/lib/cacheKeys";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

const USAGE_PROVIDERS_CACHE_TTL_MS = Math.max(
  Number.parseInt(process.env.API_CACHE_USAGE_PROVIDERS_TTL_MS || "5000", 10) || 0,
  200
);

/**
 * GET /api/usage/providers
 * Returns list of unique providers from request details
 */
export async function GET() {
  try {
    const payload = await withApiCache(API_CACHE_KEYS.usageProvidersList, USAGE_PROVIDERS_CACHE_TTL_MS, async () => {
      const db = await getRequestDetailsDb();

      const stmt = db.prepare(`
        SELECT DISTINCT provider
        FROM request_details
        WHERE provider IS NOT NULL AND provider != ''
        ORDER BY provider ASC
      `);

      const rows = stmt.all();

      // Fetch all provider nodes to get names for custom providers
      const providerNodes = await getProviderNodes();
      const nodeMap = {};
      for (const node of providerNodes) {
        nodeMap[node.id] = node.name;
      }

      const providers = rows.map(row => {
        const providerId = row.provider;

        // Try to find name from various sources
        let name = providerId;

        // 1. Check if it's a custom provider node
        if (nodeMap[providerId]) {
          name = nodeMap[providerId];
        }
        // 2. Check predefined providers
        else {
          const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
          if (providerConfig?.name) {
            name = providerConfig.name;
          }
        }

        return {
          id: providerId,
          name
        };
      });

      return { providers };
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[API] Failed to get providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 }
    );
  }
}
