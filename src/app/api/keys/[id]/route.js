import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

function parseAllowedModels(value) {
  if (Array.isArray(value)) return Array.from(new Set(value.map((m) => typeof m === "string" ? m.trim() : "").filter(Boolean)));
  if (typeof value === "string") {
    return Array.from(new Set(value.split(/[\n,]/).map((m) => m.trim()).filter(Boolean)));
  }
  return [];
}

function addPolicyPatch(body, updateData) {
  if (Object.prototype.hasOwnProperty.call(body, "name")) updateData.name = body.name;
  if (Object.prototype.hasOwnProperty.call(body, "dailyTokenLimit")) {
    const dailyTokenLimit = body.dailyTokenLimit === "" || body.dailyTokenLimit == null ? 0 : Number(body.dailyTokenLimit);
    if (!Number.isInteger(dailyTokenLimit) || dailyTokenLimit < 0) {
      return "dailyTokenLimit must be a non-negative integer";
    }
    updateData.dailyTokenLimit = dailyTokenLimit;
  }
  if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) {
    if (!body.expiresAt) {
      updateData.expiresAt = null;
    } else {
      const date = new Date(body.expiresAt);
      if (Number.isNaN(date.getTime())) return "expiresAt must be a valid date";
      updateData.expiresAt = date.toISOString();
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "allowedModels")) {
    updateData.allowedModels = parseAllowedModels(body.allowedModels);
  }
  return null;
}

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

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    const policyError = addPolicyPatch(body, updateData);
    if (policyError) {
      return NextResponse.json({ error: policyError }, { status: 400 });
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
