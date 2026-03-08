import { NextResponse } from "next/server";
import { getProviderConnections, getProviderNodes } from "@/models";
import { getUserIdFromRequest } from "@/lib/auth/getUserIdFromRequest";
import { isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";

export const dynamic = "force-dynamic";

/**
 * GET /api/providers/me
 * Returns provider connections for the current user (for usage/quota views).
 * No admin required. If no user (e.g. single-user mode), returns all connections.
 */
export async function GET(request) {
  try {
    const userId = await getUserIdFromRequest(request);

    const connections = await getProviderConnections({}, userId);

    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch {}

    const safeConnections = connections.map((c) => {
      const isCompatible =
        isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      return {
        ...c,
        name,
        apiKey: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        idToken: undefined,
      };
    });

    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.error("[api/providers/me]", error);
    const status = error.message === "Authentication required" ? 401 : 500;
    return NextResponse.json(
      { error: error.message || "Failed to fetch providers" },
      { status }
    );
  }
}
