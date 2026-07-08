import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey, getApiKeyUsageTotals } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    const usage = await getApiKeyUsageTotals(id);
    return NextResponse.json({ key: { ...key, usage } });
  } catch (error) {
    console.log("Error fetching key:", error);
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isActive, allowedModels, maxTokens, maxCostUsd } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;

    // Merge policy fields — only update fields that are explicitly provided
    const policyUpdate = {};
    if (Array.isArray(allowedModels)) policyUpdate.allowedModels = allowedModels;
    if (maxTokens !== undefined) policyUpdate.maxTokens = maxTokens != null ? Number(maxTokens) : null;
    if (maxCostUsd !== undefined) policyUpdate.maxCostUsd = maxCostUsd != null ? Number(maxCostUsd) : null;
    if (Object.keys(policyUpdate).length > 0) {
      updateData.policy = { ...existing.policy, ...policyUpdate };
    }

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
