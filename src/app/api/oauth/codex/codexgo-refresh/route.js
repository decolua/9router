import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/models";
import {
  buildCodexGoCredentialUpdate,
  codexGoSafeConnection,
} from "@/lib/oauth/codexgoConnection";
import {
  recordCodexGoRefresh,
} from "@/lib/oauth/services/codexGoRefreshPolicy";
import { refreshCodexGoSession } from "open-sse/services/codexGo.js";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const connectionId = trimString(body?.connectionId);
  if (!connectionId) {
    return NextResponse.json({ error: "Connection ID is required" }, { status: 400 });
  }

  try {
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (connection.provider !== "codex" || connection.providerSpecificData?.authMethod !== "codexgo") {
      return NextResponse.json({ error: "Connection is not a CodexGo-backed Codex account" }, { status: 400 });
    }
    if (!connection.refreshToken) {
      return NextResponse.json({ error: "CodexGo integration token is missing" }, { status: 400 });
    }

    const syncedCredentials = await refreshCodexGoSession(connection.refreshToken, console);
    const updates = buildCodexGoCredentialUpdate(connection, syncedCredentials);
    updates.providerSpecificData = recordCodexGoRefresh(
      updates.providerSpecificData,
      "manual",
      new Date().toISOString(),
    );
    const updated = await updateProviderConnection(connectionId, updates);

    const updatedConnection = updated
      ? {
        ...connection,
        ...updates,
        ...updated,
        providerSpecificData: {
          ...(updates.providerSpecificData || {}),
          ...(updated.providerSpecificData || {}),
        },
      }
      : { ...connection, ...updates };

    return NextResponse.json({
      success: true,
      connection: codexGoSafeConnection(updatedConnection),
    });
  } catch (error) {
    console.log("CodexGo manual refresh error:", error?.message || error);
    return NextResponse.json({ error: error.message || "Failed to refresh CodexGo account" }, { status: 500 });
  }
}
