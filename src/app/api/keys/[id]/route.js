import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { QUOTA_ACCESS_MODES } from "@/shared/utils/quotaAccess.js";
import { recordRetentionChange, maskKeyForDisplay } from "@/lib/promptRetention.js";

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
    const { isActive, access, quotaAccess, promptRetentionEnabled, name } = body;
    if (Object.hasOwn(body, "promptRetentionEnabled") && typeof promptRetentionEnabled !== "boolean") {
      return NextResponse.json({ error: "promptRetentionEnabled must be a boolean" }, { status: 400 });
    }
    if (Object.hasOwn(body, "name")) {
      if (typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
      }
      if (name.trim().length > 100) {
        return NextResponse.json({ error: "name must be at most 100 characters" }, { status: 400 });
      }
    }

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (Object.hasOwn(body, "name")) updateData.name = name.trim();
    if (promptRetentionEnabled !== undefined) updateData.promptRetentionEnabled = promptRetentionEnabled;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }
    if (quotaAccess !== undefined) {
      if (!QUOTA_ACCESS_MODES.includes(quotaAccess)) {
        return NextResponse.json({ error: "Invalid quotaAccess mode" }, { status: 400 });
      }
      updateData.quotaAccess = quotaAccess;
    }

    const updated = await updateApiKey(id, updateData);

    if (updated && Object.hasOwn(updateData, "promptRetentionEnabled")) {
      recordRetentionChange(id, updated.name, maskKeyForDisplay(updated.key), updated.promptRetentionEnabled === true, "dashboard");
    }
    // Pausing a key revokes its retained prompts — record the consent loss.
    if (updated && updateData.isActive === false && updated.promptRetentionEnabled === true) {
      recordRetentionChange(id, updated.name, maskKeyForDisplay(updated.key), false, "key-paused");
    }

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

    const existing = await getApiKeyById(id);
    const deleted = await deleteApiKey(id);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // Deleting a key revokes any retained prompts for it — record the consent loss.
    if (existing?.promptRetentionEnabled === true) {
      recordRetentionChange(id, existing.name, maskKeyForDisplay(existing.key), false, "key-deleted");
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
