import { NextResponse } from "next/server";
import { getAuditLogs } from "@/lib/db/repos/auditLogRepo.js";
import { withAdminUser } from "@/lib/auth/runtimeUserContext.js";

export const dynamic = "force-dynamic";

export const GET = withAdminUser(async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "100", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const events = await getAuditLogs({ limit, offset });
    return NextResponse.json({ events });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
