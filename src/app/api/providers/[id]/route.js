import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection, deleteProviderConnection } from "@/models";
import { requireAdmin } from "@/lib/auth/helpers";

// GET /api/providers/[id] - Get single connection (admin only, global config)
export async function GET(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const connection = await getProviderConnectionById(id, null);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    // Hide sensitive fields
    const result = { ...connection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to fetch connection" }, { status });
  }
}

// PUT /api/providers/[id] - Update connection (admin only)
export async function PUT(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();
    const {
      name,
      priority,
      globalPriority,
      defaultModel,
      isActive,
      apiKey,
      testStatus,
      lastError,
      lastErrorAt,
      providerSpecificData
    } = body;

    const existing = await getProviderConnectionById(id, null);
    if (!existing) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (priority !== undefined) updateData.priority = priority;
    if (globalPriority !== undefined) updateData.globalPriority = globalPriority;
    if (defaultModel !== undefined) updateData.defaultModel = defaultModel;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (apiKey && existing.authType === "apikey") updateData.apiKey = apiKey;
    if (testStatus !== undefined) updateData.testStatus = testStatus;
    if (lastError !== undefined) updateData.lastError = lastError;
    if (lastErrorAt !== undefined) updateData.lastErrorAt = lastErrorAt;
    if (providerSpecificData !== undefined) {
      updateData.providerSpecificData = {
        ...(existing.providerSpecificData || {}),
        ...providerSpecificData,
      };
    }

    const updated = await updateProviderConnection(id, updateData, null);

    // Hide sensitive fields
    const result = { ...updated };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to update connection" }, { status });
  }
}

// DELETE /api/providers/[id] - Delete connection (admin only)
export async function DELETE(request, { params }) {
  try {
    await requireAdmin(request);
    const { id } = await params;

    const deleted = await deleteProviderConnection(id, null);
    if (!deleted) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Connection deleted successfully" });
  } catch (error) {
    const status = error.message === "Admin access required" || error.message === "Authentication required" ? 403 : 500;
    return NextResponse.json({ error: error.message || "Failed to delete connection" }, { status });
  }
}
