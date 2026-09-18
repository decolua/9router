import { NextResponse } from "next/server";
import { getConsentLog } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/dlp/consent-log?limit=100 — audit trail of DLP consent changes
// (append-only; limit only bounds the response size, nothing is deleted).
export async function GET(request) {
  try {
    const rawLimit = request.nextUrl?.searchParams?.get("limit");
    const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;
    const entries = await getConsentLog({ limit });
    return NextResponse.json({ entries, total: entries.length });
  } catch (error) {
    console.log("Error reading consent log:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}