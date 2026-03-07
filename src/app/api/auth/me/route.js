import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/helpers";

/**
 * GET /api/auth/me
 * Returns current user from session (headers set by dashboard guard).
 * Used by dashboard UI to know isAdmin and show/hide Admin nav.
 */
export async function GET(request) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    tenantId: user.tenantId ?? null,
  });
}
