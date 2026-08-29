import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { syncModelCatalog } from "@/lib/modelCatalog/sync.js";
import { rebuildControlCenter } from "@/lib/modelControlCenter/catalog.js";

export const dynamic = "force-dynamic";

function cleanModels(models) {
  if (!Array.isArray(models)) return [];
  return models
    .slice(0, 5000)
    .map((model) => {
      const id = String(model?.id || model?.model || model?.name || "").trim();
      if (!id) return null;
      return {
        id,
        name: String(model?.name || model?.displayName || id),
        kind: model?.kind || model?.type || (Array.isArray(model?.kinds) ? model.kinds[0] : undefined),
      };
    })
    .filter(Boolean);
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const active = await getProviderConnections({ isActive: true });
    const byId = new Map(active.map((connection) => [connection.id, connection]));

    const discovery = [];
    for (const item of Array.isArray(body.discovery) ? body.discovery : []) {
      const connection = byId.get(item?.connectionId);
      if (!connection) continue;
      if (item.provider && item.provider !== connection.provider) continue;
      discovery.push({
        connectionId: connection.id,
        provider: connection.provider,
        models: cleanModels(item.models),
        warning: typeof item.warning === "string" ? item.warning.slice(0, 500) : null,
      });
    }

    let capabilitySync = null;
    if (body.syncCapabilities !== false) {
      capabilitySync = await syncModelCatalog();
    }

    const state = await rebuildControlCenter(discovery);
    return NextResponse.json({
      success: true,
      capabilitySync,
      state,
    });
  } catch (error) {
    console.log("[modelControlCenter] refresh failed:", error);
    return NextResponse.json(
      { error: error?.message || "Refresh failed" },
      { status: 500 },
    );
  }
}
