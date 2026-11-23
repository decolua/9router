import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { resolveKeyAccessInput } from "@/shared/utils/keyAccess.js";

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
    const { name, isActive, access, tokenLimit, usedTokens } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (access !== undefined || body.allowedModels !== undefined) {
      const checked = resolveKeyAccessInput(body);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }
    for (const field of ["tokenLimit", "usedTokens"]) {
      if (body[field] !== undefined && (!Number.isSafeInteger(body[field]) || body[field] < 0)) {
        return NextResponse.json({ error: `${field} must be a non-negative integer` }, { status: 400 });
      }
    }
    if (tokenLimit !== undefined) updateData.tokenLimit = tokenLimit;
    if (usedTokens !== undefined) updateData.usedTokens = usedTokens;

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
