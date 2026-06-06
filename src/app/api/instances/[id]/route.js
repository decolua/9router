import { NextResponse } from "next/server";
import { getInstanceById, updateInstance, deleteInstance } from "@/lib/localDb";

// GET /api/instances/[id]
export async function GET(_req, { params }) {
  try {
    const { id } = await params;
    const instance = await getInstanceById(id);
    if (!instance) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { getInstanceStatus } = require("@/lib/instances/manager");
    const status = getInstanceStatus(id);
    return NextResponse.json({ ...instance, ...status });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH /api/instances/[id]
export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const allowed = ["name", "port", "dataDir", "autoStart"];
    const updates = Object.fromEntries(
      Object.entries(body).filter(([k]) => allowed.includes(k))
    );
    if (updates.port) updates.port = Number(updates.port);

    const updated = await updateInstance(id, updates);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/instances/[id]
export async function DELETE(_req, { params }) {
  try {
    const { id } = await params;
    // Stop first if running
    const { stopInstance } = require("@/lib/instances/manager");
    stopInstance(id);

    const ok = await deleteInstance(id);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
