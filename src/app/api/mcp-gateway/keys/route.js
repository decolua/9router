import { NextResponse } from "next/server";
import { getGatewayKeys, createGatewayKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { isLocalRequest } from "@/dashboardGuard";

export const dynamic = "force-dynamic";

function stripKey(k) {
  if (!k) return k;
  // NEVER return the raw key on list. Only on create.
  const { key: _key, ...rest } = k;
  void _key;
  return rest;
}

export async function GET() {
  try {
    const keys = await getGatewayKeys();
    return NextResponse.json({ keys: keys.map(stripKey) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    // Key creation reveals the raw key. Restrict to local requests (SSRF-style
    // protection — remote callers must not be able to create and reveal keys).
    if (!isLocalRequest(request)) {
      return NextResponse.json(
        { error: "Key creation is only available from local requests." },
        { status: 403 }
      );
    }
    const body = await request.json().catch(() => ({}));
    const machineId = await getConsistentMachineId();
    const row = await createGatewayKey(body.name ?? null, machineId);
    // Return the raw key ONCE on create so the user can copy it.
    return NextResponse.json({ key: row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
