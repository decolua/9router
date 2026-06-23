import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";

// GET /api/keys/[id] - Get single key
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
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
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await request.json() as {
      isActive?: boolean;
      name?: string;
      role?: string;
      allowedModels?: unknown;
      allowedProviders?: unknown;
      monthlyTokenLimit?: number;
      monthlyBudgetUsd?: number;
    };
    const { isActive, name, role, allowedModels, allowedProviders, monthlyTokenLimit, monthlyBudgetUsd } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData: {
      isActive?: boolean;
      name?: string;
      role?: string;
      allowedModels?: string[];
      allowedProviders?: string[];
      monthlyTokenLimit?: number;
      monthlyBudgetUsd?: number;
    } = {};
    if (isActive !== undefined) updateData.isActive = isActive;
    if (name !== undefined) updateData.name = name;
    if (role !== undefined) updateData.role = role;
    if (allowedModels !== undefined) {
      if (!Array.isArray(allowedModels)) {
        return NextResponse.json({ error: "allowedModels must be an array" }, { status: 400 });
      }
      updateData.allowedModels = allowedModels as string[];
    }
    if (allowedProviders !== undefined) {
      if (!Array.isArray(allowedProviders)) {
        return NextResponse.json({ error: "allowedProviders must be an array" }, { status: 400 });
      }
      updateData.allowedProviders = allowedProviders as string[];
    }
    if (monthlyTokenLimit !== undefined) updateData.monthlyTokenLimit = monthlyTokenLimit;
    if (monthlyBudgetUsd !== undefined) updateData.monthlyBudgetUsd = monthlyBudgetUsd;

    const updated = await updateApiKey(id, updateData);

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.log("Error updating key:", error);
    return NextResponse.json({ error: "Failed to update key" }, { status: 500 });
  }
}

// DELETE /api/keys/[id] - Delete API key
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;

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
