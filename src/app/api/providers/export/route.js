import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";

// GET /api/providers/export?provider=<providerId>
// Returns raw (unmasked) name|apiKey|group for every connection under one
// provider — the exact format the bulk-add textarea (AddApiKeyModal) parses
// back in (see src/shared/utils/bulkAdd.js). Unlike GET /api/providers,
// this deliberately includes the real apiKey — only call it for an explicit
// user-initiated export, never for a general list render.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const provider = searchParams.get("provider");
  if (!provider) {
    return NextResponse.json({ error: "provider query param is required" }, { status: 400 });
  }

  const connections = await getProviderConnections({ provider });
  const lines = connections
    .filter((c) => c.authType !== "oauth" && c.apiKey)
    .map((c) => `${c.name || "Key"}|${c.apiKey}|${c.group || ""}`);

  return NextResponse.json({ lines });
}
