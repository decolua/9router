import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/helpers";

/**
 * POST /api/shutdown — Gracefully exit the server.
 * Admin only: only users with isAdmin can trigger shutdown.
 */
export async function POST(request) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!user.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(() => {
    process.exit(0);
  }, 500);

  return response;
}

