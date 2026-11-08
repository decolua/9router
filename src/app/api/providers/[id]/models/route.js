import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/models";
import { fetchModelsForConnection } from "@/lib/providerModels/fetchModels";

/**
 * GET /api/providers/[id]/models - Get models list from provider
 *
 * The provider-specific fetching lives in @/lib/providerModels/fetchModels so
 * the bulk sync route (POST /api/providers/sync-models) shares it verbatim.
 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const result = await fetchModelsForConnection(connection);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }

    return NextResponse.json({
      provider: connection.provider,
      connectionId: connection.id,
      models: result.models,
      ...(result.warning ? { warning: result.warning } : {}),
    });
  } catch (error) {
    console.log("Error fetching provider models:", error);
    return NextResponse.json({ error: "Failed to fetch models" }, { status: 500 });
  }
}
