import { KeyConnectionError } from "@/lib/db/index.js";
import { requireDashboardAdmin } from "@/dashboardGuard";
import { audit } from "@/lib/observability/audit";
import { validateKeyPolicy } from "@/shared/utils/keyPolicy.js";
import { validateKeyAccessInput } from "@/shared/utils/keyAccess.js";
import { NextResponse } from "next/server";
import { getApiKeys, getApiKeySummaries, createApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

// GET /api/keys - List API keys
export async function GET(request) {
  try {
    const view = new URL(request.url).searchParams.get("view");
    if (view !== null && view !== "summary") return NextResponse.json({ error: "Unknown key view" }, { status: 400 });
    const keys = view === "summary" ? await getApiKeySummaries() : await getApiKeys();
    return NextResponse.json({ keys }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Failed to fetch keys" }, { status: 500 });
  }
}

// POST /api/keys - Create new API key
export async function POST(request) {
  try {
    const body = await request.json();
    if (body?.allowedConnections !== undefined) {
      const denied = await requireDashboardAdmin(request, { requireCredential: true });
      if (denied) return denied;
    }
    const policy = validateKeyPolicy(body);
    if (policy.error) return NextResponse.json({ error: policy.error }, { status: 400 });
    const { name } = body;
    if (body.access !== undefined) {
      const access = validateKeyAccessInput(body.access);
      if (!access.ok) return NextResponse.json({ error: access.error }, { status: 400 });
      policy.value.access = access.value;
    }

    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Always get machineId from server
    const machineId = await getConsistentMachineId();
    const apiKey = await createApiKey(name, machineId, policy.value);

    await audit(request, "key.create", { target: apiKey.id });
    if (body.allowedConnections !== undefined) {
      await audit(request, "key.connections", {
        target: apiKey.id,
        fields: ["allowedConnections"],
        count: policy.value.allowedConnections.length,
      });
    }
    return NextResponse.json({
      key: apiKey.key,
      name: apiKey.name,
      id: apiKey.id,
      keyVersion: apiKey.keyVersion,
      ...policy.value,
      access: apiKey.access,
      machineId: apiKey.machineId,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof KeyConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }
}
