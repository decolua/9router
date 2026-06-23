import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, renewApiKey, updateApiKey } from "@/lib/localDb";
import { normalizePlanMonths } from "@/lib/api-keys/plans";

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
    const { isActive, name, planMonths } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (name !== undefined) updateData.name = String(name || "").trim();
    if (planMonths !== undefined) updateData.planMonths = normalizePlanMonths(planMonths);

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    if (error instanceof SyntaxError || error?.message?.startsWith("Plan must be one of")) {
      return NextResponse.json({ error: "Valid planMonths is required" }, { status: 400 });
    }
    if (error?.message?.startsWith("isActive must be")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// POST /api/keys/[id] - Renew API key
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const planMonths = normalizePlanMonths(body?.planMonths);
    const key = await renewApiKey(id, planMonths);
    if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });
    return NextResponse.json({ key });
  } catch (error) {
    if (error instanceof SyntaxError || error?.message?.startsWith("Plan must be one of")) {
      return NextResponse.json({ error: "Valid planMonths is required" }, { status: 400 });
    }
    console.log("Error renewing key:", error);
    return NextResponse.json({ error: "Failed to renew key" }, { status: 500 });
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
