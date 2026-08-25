import { NextResponse } from "next/server";
import {
  getApiKeyById,
  updateApiKey,
  deleteApiKey,
} from "@/lib/db/repos/apiKeysRepo.js";
import {
  hasDashboardOrCliAuth,
  unauthorizedResponse,
} from "@/lib/auth/dashboardApiAuth";

// PUT /api/mcp-keys/[id] - Update MCP API key (toggle active status)
export async function PUT(request, { params }) {
  try {
    // Require dashboard or CLI authentication
    if (!(await hasDashboardOrCliAuth(request))) {
      return unauthorizedResponse();
    }

    const { id } = params;
    const body = await request.json();
    const { isActive } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "MCP API key not found" },
        { status: 404 },
      );
    }

    if (existing.kind !== "mcp") {
      return NextResponse.json(
        { error: "Not an MCP API key" },
        { status: 400 },
      );
    }

    const updated = await updateApiKey(id, {
      isActive: isActive !== undefined ? isActive : !existing.isActive,
    });

    return NextResponse.json({ key: updated });
  } catch (error) {
    console.error("Error updating MCP API key:", error);
    return NextResponse.json(
      { error: "Failed to update MCP API key" },
      { status: 500 },
    );
  }
}

// DELETE /api/mcp-keys/[id] - Delete MCP API key
export async function DELETE(request, { params }) {
  try {
    // Require dashboard or CLI authentication
    if (!(await hasDashboardOrCliAuth(request))) {
      return unauthorizedResponse();
    }

    const { id } = params;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json(
        { error: "MCP API key not found" },
        { status: 404 },
      );
    }

    if (existing.kind !== "mcp") {
      return NextResponse.json(
        { error: "Not an MCP API key" },
        { status: 400 },
      );
    }

    const success = await deleteApiKey(id);

    if (!success) {
      return NextResponse.json(
        { error: "Failed to delete MCP API key" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting MCP API key:", error);
    return NextResponse.json(
      { error: "Failed to delete MCP API key" },
      { status: 500 },
    );
  }
}
