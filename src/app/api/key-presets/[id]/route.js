import { NextResponse } from "next/server";
import { getKeyPresetById, updateKeyPreset, deleteKeyPreset } from "@/lib/localDb";

// PUT /api/key-presets/[id] - Update preset
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await getKeyPresetById(id);
    if (!existing) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }

    const updateData = {};
    if (body.name !== undefined) updateData.name = String(body.name).trim() || existing.name;
    if (body.models !== undefined) {
      updateData.models = Array.isArray(body.models)
        ? body.models.filter((m) => typeof m === "string" && m.trim() !== "")
        : existing.models;
    }

    const updated = await updateKeyPreset(id, updateData);
    return NextResponse.json({ preset: updated });
  } catch (error) {
    console.log("Error updating key preset:", error);
    return NextResponse.json({ error: "Failed to update preset" }, { status: 500 });
  }
}

// DELETE /api/key-presets/[id] - Delete preset
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteKeyPreset(id);
    if (!deleted) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Preset deleted" });
  } catch (error) {
    console.log("Error deleting key preset:", error);
    return NextResponse.json({ error: "Failed to delete preset" }, { status: 500 });
  }
}
