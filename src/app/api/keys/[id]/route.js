import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { normalizeModelAccess } from "@/sse/services/modelAccess.js";

const MODEL_ACCESS_MODES = new Set(["all", "allow", "deny"]);

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key });
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
    const { isActive, modelAccess } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (modelAccess !== undefined) {
      if (!modelAccess || typeof modelAccess !== "object" || Array.isArray(modelAccess)
        || !MODEL_ACCESS_MODES.has(modelAccess.mode)) {
        return NextResponse.json({ error: "Invalid modelAccess mode" }, { status: 400 });
      }
      if (!Array.isArray(modelAccess.patterns) || modelAccess.patterns.some((pattern) => typeof pattern !== "string")) {
        return NextResponse.json({ error: "modelAccess patterns must be an array of strings" }, { status: 400 });
      }
      updateData.modelAccess = normalizeModelAccess(modelAccess);
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
