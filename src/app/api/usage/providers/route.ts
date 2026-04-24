import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/requestDetailsDb";
import { getProviderNodes } from "@/lib/localDb";
import { AI_PROVIDERS, getProviderByAlias } from "@/shared/constants/providers";

/**
 * GET /api/usage/providers
 * Returns list of unique providers from request details
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { details } = await getRequestDetails({ pageSize: 9999 });

    // Extract unique providers
    const providerIds = [...new Set(details.map((r: any) => r.provider).filter(Boolean))].sort();

    const providerNodes = await getProviderNodes();
    const nodeMap: Record<string, string> = {};
    for (const node of providerNodes) {
      nodeMap[node.id] = node.name;
    }

    const providers = providerIds.map((providerId: any) => {
      let name = providerId;
      if (nodeMap[providerId]) {
        name = nodeMap[providerId];
      } else {
        const providerConfig = getProviderByAlias(providerId) || (AI_PROVIDERS as any)[providerId];
        if (providerConfig?.name) name = providerConfig.name;
      }
      return { id: providerId, name };
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
