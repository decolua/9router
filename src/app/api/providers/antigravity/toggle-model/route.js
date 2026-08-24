import { NextResponse } from "next/server";
import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/antigravity/toggle-model
 * Body: { connectionId, model, disabled: boolean }
 * Adds/removes model from connection's disabledModels array.
 */
export async function POST(request) {
  try {
    const { connectionId, model, disabled } = await request.json();
    if (!connectionId || !model || typeof disabled !== "boolean") {
      return NextResponse.json({ error: "connectionId, model, and boolean disabled required" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider: "antigravity" });
    const conn = connections.find(c => c.id === connectionId);
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const current = Array.isArray(conn.disabledModels) ? conn.disabledModels : [];
    const updated = disabled
      ? [...new Set([...current, model])]
      : current.filter(m => m !== model);

    await updateProviderConnection(connectionId, { disabledModels: updated });

    return NextResponse.json({ ok: true, disabledModels: updated });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * GET /api/providers/antigravity/toggle-model?connectionId=xxx
 * Returns disabledModels for a connection.
 */
export async function GET(request) {
  const connectionId = new URL(request.url).searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId required" }, { status: 400 });
  }

  const connections = await getProviderConnections({ provider: "antigravity" });
  const conn = connections.find(c => c.id === connectionId);
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  return NextResponse.json({
    connectionId,
    disabledModels: Array.isArray(conn.disabledModels) ? conn.disabledModels : [],
  });
}
