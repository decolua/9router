import { NextResponse } from "next/server";
import { getProviderConnectionById } from "@/lib/localDb";
import { fetchCustomQuota, validateCustomQuotaConfig } from "@/lib/customQuota";

// POST /api/quota/custom/test — dry-run a source and return the resolved rows.
export async function POST(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const connectionId = payload?.connectionId;
  const config = payload?.config;
  if (!connectionId) {
    return NextResponse.json({ error: "connectionId is required" }, { status: 400 });
  }

  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  const errors = validateCustomQuotaConfig(config);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" "), errors }, { status: 400 });
  }

  const result = await fetchCustomQuota(config, connection, { includeRaw: true });
  return NextResponse.json(result);
}
