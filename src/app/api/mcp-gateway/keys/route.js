import { NextResponse } from "next/server";
import { getGatewayKeys, createGatewayKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

export const dynamic = "force-dynamic";

function stripKey(k) {
  if (!k) return k;
  // NEVER return the raw key on list. Only on create.
  const { key, ...rest } = k;
  return rest;
}

export async function GET() {
  try {
    const keys = await getGatewayKeys();
    return NextResponse.json({ keys: keys.map(stripKey) });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const machineId = await getConsistentMachineId();
    const row = await createGatewayKey(body.name || null, machineId);
    // Return the raw key ONCE on create so the user can copy it.
    return NextResponse.json({ key: row }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
