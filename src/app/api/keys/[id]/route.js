import { KeyConnectionError } from "@/lib/db/index.js";
import { requireDashboardAdmin } from "@/dashboardGuard";
import { audit } from "@/lib/observability/audit";
import { validateKeyPolicy } from "@/shared/utils/keyPolicy.js";
import { NextResponse } from "next/server";
import { deleteApiKey, getApiKeyById, updateApiKey } from "@/lib/localDb";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";

// GET /api/keys/[id] - Get single key
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const key = await getApiKeyById(id);
    if (!key) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ key }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Failed to fetch key" }, { status: 500 });
  }
}

// PUT /api/keys/[id] - Update key
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body?.allowedConnections !== undefined) {
      const denied = await requireDashboardAdmin(request, { requireCredential: true });
      if (denied) return denied;
    }
    const policy = validateKeyPolicy(body);
    if (policy.error) return NextResponse.json({ error: policy.error }, { status: 400 });
    const { isActive, access } = body;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    const updateData = { ...policy.value };
    if (isActive !== undefined) updateData.isActive = isActive;
    if (access !== undefined) {
      const checked = validateKeyAccessInput(access);
      if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
      updateData.access = checked.value;
    }

    const updated = await updateApiKey(id, updateData);

    if (isActive !== undefined) await audit(request, isActive ? "key.resume" : "key.pause", { target: id });
    if (body.allowedConnections !== undefined) {
      await audit(request, "key.connections", {
        target: id,
        fields: ["allowedConnections"],
        count: policy.value.allowedConnections.length,
      });
    }
    const fields = Object.keys(updateData).filter(k => k !== "isActive" && k !== "allowedConnections");
    if (fields.length) await audit(request, "key.policy", { target: id, fields });
    return NextResponse.json({ key: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof KeyConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
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

    await audit(request, "key.delete", { target: id });
    return NextResponse.json({ message: "Key deleted successfully" });
  } catch {
    return NextResponse.json({ error: "Failed to delete key" }, { status: 500 });
  }
}
