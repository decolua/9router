import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, getApiKeys, updateApiKey } from "@/lib/localDb";

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
    const { isActive } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // Enforce unique key names on rename — mirrors POST /api/keys
    let trimmedName;
    if (body.name !== undefined) {
      trimmedName = typeof body.name === "string" ? body.name.trim() : "";
      if (!trimmedName) {
        return NextResponse.json({ error: "Name is required" }, { status: 400 });
      }
      const existingKeys = await getApiKeys();
      if (existingKeys.some((k) => k.id !== id && k.name === trimmedName)) {
        return NextResponse.json({ error: `A key named "${trimmedName}" already exists. Use a different name.` }, { status: 409 });
      }
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (trimmedName !== undefined) updateData.name = trimmedName;
    if (body.tokenLimit !== undefined) updateData.tokenLimit = Number(body.tokenLimit);
    if (body.resetInterval !== undefined) updateData.resetInterval = body.resetInterval;
    if (body.usedTokens !== undefined) updateData.usedTokens = Number(body.usedTokens);
    if (body.lastResetAt !== undefined) updateData.lastResetAt = body.lastResetAt;
    if (body.allowedModels !== undefined) updateData.allowedModels = body.allowedModels;
    if (body.rpmLimit !== undefined) updateData.rpmLimit = Number(body.rpmLimit);
    if (body.tpmLimit !== undefined) updateData.tpmLimit = Number(body.tpmLimit);
    if (body.ipWhitelist !== undefined) updateData.ipWhitelist = body.ipWhitelist;
 if (body.expiresAt !== undefined) updateData.expiresAt = body.expiresAt || null;
 if (body.systemPrompt !== undefined) updateData.systemPrompt = body.systemPrompt;

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
