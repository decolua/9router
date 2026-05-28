import { NextResponse } from "next/server";
import { getKeyGroupById, updateKeyGroup, deleteKeyGroup } from "@/models";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const group = await getKeyGroupById(id);
    if (!group) return NextResponse.json({ error: "Key group not found" }, { status: 404 });
    return NextResponse.json({ group });
  } catch (error) {
    console.log("Error fetching key group:", error);
    return NextResponse.json({ error: "Failed to fetch key group" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const existing = await getKeyGroupById(id);
    if (!existing) return NextResponse.json({ error: "Key group not found" }, { status: 404 });

    const updateData = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.allowedConnectionIds !== undefined) updateData.allowedConnectionIds = body.allowedConnectionIds;

    const group = await updateKeyGroup(id, updateData);
    return NextResponse.json({ group });
  } catch (error) {
    console.log("Error updating key group:", error);
    return NextResponse.json({ error: "Failed to update key group" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteKeyGroup(id);
    if (!deleted) return NextResponse.json({ error: "Key group not found" }, { status: 404 });
    return NextResponse.json({ message: "Key group deleted successfully" });
  } catch (error) {
    console.log("Error deleting key group:", error);
    return NextResponse.json({ error: "Failed to delete key group" }, { status: 500 });
  }
}
