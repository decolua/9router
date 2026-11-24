import { NextResponse } from "next/server";
import { getApiKeyById, rotateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// POST /api/keys/[id]/rotate - Replace the key's secret, keep id/name/access/isActive.
// The old secret stops working as soon as this returns.
export async function POST(request, { params }) {
  try {
    const { id } = await params;

    const existing = await getApiKeyById(id);
    if (!existing) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    // Always get machineId from server (same as create)
    const machineId = await getConsistentMachineId();
    const rotated = await rotateApiKey(id, machineId);
    if (!rotated) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ key: rotated });
  } catch (error) {
    console.log("Error rotating key:", error);
    return NextResponse.json({ error: "Failed to rotate key" }, { status: 500 });
  }
}
