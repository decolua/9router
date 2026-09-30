import { NextResponse } from "next/server";
import { getDistinctProviders } from "@/lib/requestDetailsDb";
import { getProviderNodes } from "@/lib/localDb";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";
import { getSessionContext } from "@/lib/auth/dashboardPermissions";
import { parseAllowedModels } from "@/lib/db/repos/allowedModels.js";

/**
 * GET /api/usage/providers
 * Returns list of unique providers from request details
 */
export async function GET() {
  try {
    // An API-key session only sees providers that served one of its allowed models,
    // so the filter dropdown cannot be used to discover unrelated providers.
    const ctx = await getSessionContext();
    const allowedModelPatterns = parseAllowedModels(ctx.allowedModels || "*");

    // Query DISTINCT provider column directly — avoids parsing every row's
    // full JSON blob (can be hundreds of MB), which previously caused OOM.
    const providerIds = await getDistinctProviders(allowedModelPatterns);

    const providerNodes = await getProviderNodes();
    const nodeMap = {};
    for (const node of providerNodes) {
      nodeMap[node.id] = { name: node.name, logo: node.logo || null };
    }

    const providers = providerIds.map(providerId => {
      let name = providerId;
      let nodeLogo = null;
      if (nodeMap[providerId]) {
        name = nodeMap[providerId].name;
        nodeLogo = nodeMap[providerId].logo;
      } else {
        const providerConfig = getProviderByAlias(providerId) || AI_PROVIDERS[providerId];
        if (providerConfig?.name) name = providerConfig.name;
      }
      return { id: providerId, name, provider: providerId, nodeName: name, nodeLogo, logo: nodeLogo };
    });

    return NextResponse.json({ providers });
  } catch (error) {
    console.error("[API] Failed to get providers:", error);
    return NextResponse.json(
      { error: "Failed to fetch providers" },
      { status: 500 }
    );
  }
}
