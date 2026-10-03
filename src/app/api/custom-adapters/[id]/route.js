import { NextResponse } from "next/server";
import { getCustomAdapterById, updateCustomAdapter, deleteCustomAdapter } from "@/models";

export const dynamic = "force-dynamic";

// GET /api/custom-adapters/[id] - Get custom adapter by id
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const adapter = await getCustomAdapterById(id);
    if (!adapter) {
      return NextResponse.json({ error: "Custom adapter not found" }, { status: 404 });
    }
    return NextResponse.json({ adapter });
  } catch (error) {
    console.error("Error fetching custom adapter:", error);
    return NextResponse.json({ error: "Failed to fetch custom adapter" }, { status: 500 });
  }
}

// PUT /api/custom-adapters/[id] - Update custom adapter
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await getCustomAdapterById(id);
    if (!existing) {
      return NextResponse.json({ error: "Custom adapter not found" }, { status: 404 });
    }

    if (existing.source === "file") {
      return NextResponse.json({ error: "File-based adapters cannot be edited via API. Edit the file directly in custom-providers/" }, { status: 400 });
    }

    const updated = await updateCustomAdapter(id, body);
    return NextResponse.json({ adapter: updated });
  } catch (error) {
    console.error("Error updating custom adapter:", error);
    return NextResponse.json({ error: error.message || "Failed to update custom adapter" }, { status: 500 });
  }
}

// DELETE /api/custom-adapters/[id] - Delete custom adapter
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const existing = await getCustomAdapterById(id);
    if (!existing) {
      return NextResponse.json({ error: "Custom adapter not found" }, { status: 404 });
    }

    if (existing.source === "file") {
      return NextResponse.json({ error: "File-based adapters cannot be deleted via API. Remove the file from custom-providers/" }, { status: 400 });
    }

    const deleted = await deleteCustomAdapter(id);
    return NextResponse.json({ success: true, adapter: deleted });
  } catch (error) {
    console.error("Error deleting custom adapter:", error);
    return NextResponse.json({ error: "Failed to delete custom adapter" }, { status: 500 });
  }
}
