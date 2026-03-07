import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { getUserIdFromRequest } from "@/lib/auth/getUserIdFromRequest";

// GET /api/keys/[id] - Get single key (scoped by user when logged in)
export async function GET(request, { params }) {
  try {
    const userId = await getUserIdFromRequest(request);
    const { id } = await params;
    const key = await getApiKeyById(id, userId);
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
    const userId = await getUserIdFromRequest(request);
    const { id } = await params;
    const body = await request.json();
    const { isActive } = body;

    const existing = await getApiKeyById(id, userId);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await updateApiKey(id, updateData, userId);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(request, { params }) {
  try {
    const userId = await getUserIdFromRequest(request);
    const { id } = await params;

    const deleted = await deleteApiKey(id, userId);
    if (!deleted) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Key deleted successfully" });
  } catch (error) {
    console.log("Error deleting key:", error);
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
