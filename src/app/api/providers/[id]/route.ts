import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import {
  getProviderConnectionById,
  getProxyPoolById,
  updateProviderConnection,
  deleteProviderConnection,
} from "@/lib/localDb";

function normalizeProxyConfig(body: {
  connectionProxyEnabled?: boolean;
  connectionProxyUrl?: string;
  connectionNoProxy?: string;
}) {
  const hasAnyProxyField =
    Object.hasOwn(body, "connectionProxyEnabled") ||
    Object.hasOwn(body, "connectionProxyUrl") ||
    Object.hasOwn(body, "connectionNoProxy");

  if (!hasAnyProxyField) return { hasAnyProxyField: false } as const;

  const enabled = body.connectionProxyEnabled === true;
  const url = typeof body.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return { hasAnyProxyField: true as const, error: "Connection proxy URL is required when connection proxy is enabled" as const };
  }
  return { hasAnyProxyField: true as const, connectionProxyEnabled: enabled, connectionProxyUrl: url, connectionNoProxy: noProxy };
}

async function normalizeProxyPoolUpdate(proxyPoolIdInput: string | null | undefined) {
  if (proxyPoolIdInput === undefined) return { hasProxyPoolField: false as const, proxyPoolId: null };
  if (proxyPoolIdInput === null || proxyPoolIdInput === "" || proxyPoolIdInput === "__none__") {
    return { hasProxyPoolField: true as const, proxyPoolId: null };
  }
  const trimmed = String(proxyPoolIdInput).trim();
  if (!trimmed) return { hasProxyPoolField: true as const, proxyPoolId: null };
  const proxyPool = await getProxyPoolById(trimmed);
  if (!proxyPool) return { hasProxyPoolField: true as const, error: "Proxy pool not found" as const, proxyPoolId: null };
  return { hasProxyPoolField: true as const, proxyPoolId: trimmed };
}

// GET /api/providers/[id] - Get single connection
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const connection = await getProviderConnectionById(id);
    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const result = Object.assign({}, connection);
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;
    return NextResponse.json({ connection: result });
  } catch (error) {
    console.log("Error fetching connection:", error);
    return NextResponse.json({ error: "Failed to fetch connection" }, { status: 500 });
  }
}

// PUT /api/providers/[id] - Update connection
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as {
      name?: string;
      priority?: number;
      globalPriority?: number | null;
      defaultModel?: string | null;
      isActive?: boolean;
      apiKey?: string;
      testStatus?: string;
      lastError?: string | null;
      lastErrorAt?: string | null;
      providerSpecificData?: Record<string, JsonValue>;
      proxyPoolId?: string | null;
      connectionProxyEnabled?: boolean;
      connectionProxyUrl?: string;
      connectionNoProxy?: string;
    };
    const { name, priority, globalPriority, defaultModel, isActive, apiKey, testStatus, lastError, lastErrorAt, providerSpecificData } = body;

    const existing = await getProviderConnectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const proxyConfig = normalizeProxyConfig(body);
    if ("error" in proxyConfig) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolUpdate(body.proxyPoolId);
    if ("error" in proxyPoolResult) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }

    const updateData: {
      name?: string;
      priority?: number;
      globalPriority?: number | null;
      defaultModel?: string | null;
      isActive?: boolean;
      apiKey?: string;
      testStatus?: string;
      lastError?: string | null;
      lastErrorAt?: string | null;
      providerSpecificData?: Record<string, JsonValue>;
    } = {};

    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;

    if (existing.providerSpecificData !== undefined || providerSpecificData !== undefined || proxyConfig.hasAnyProxyField || proxyPoolResult.hasProxyPoolField) {
      const existingPsd = existing.providerSpecificData as Record<string, JsonValue> | undefined;
      const merged: Record<string, JsonValue | undefined> = { ...(existingPsd || {}), ...(providerSpecificData || {}) };

      if (proxyConfig.hasAnyProxyField) {
        merged.connectionProxyEnabled = proxyConfig.connectionProxyEnabled;
        merged.connectionProxyUrl = proxyConfig.connectionProxyUrl;
        merged.connectionNoProxy = proxyConfig.connectionNoProxy;
      }
      if (proxyPoolResult.hasProxyPoolField) {
        if (proxyPoolResult.proxyPoolId === null) {
          delete merged.proxyPoolId;
        } else {
          merged.proxyPoolId = proxyPoolResult.proxyPoolId;
        }
      }
      updateData.providerSpecificData = merged as Record<string, JsonValue>;
    }

    const updateRecord: Record<string, unknown> = Object.assign({}, updateData);
    const updated = await updateProviderConnection(id, updateRecord);
    if (!updated) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const updatedRecord: Record<string, unknown> = Object.assign({}, updated);
    delete updatedRecord["apiKey"];
    delete updatedRecord["accessToken"];
    delete updatedRecord["refreshToken"];
    delete updatedRecord["idToken"];
    return NextResponse.json({ connection: updatedRecord });
  } catch (error) {
    console.log("Error updating connection:", error);
    return NextResponse.json({ error: "Failed to update connection" }, { status: 500 });
  }
}

// DELETE /api/providers/[id] - Delete connection
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const deleted = await deleteProviderConnection(id);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    console.log("Error deleting connection:", error);
    return NextResponse.json({ error: "Failed to delete connection" }, { status: 500 });
  }
}
