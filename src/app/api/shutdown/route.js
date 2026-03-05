import { NextResponse } from "next/server";
import { requireAuth, unauthorizedResponse } from "@/lib/apiAuth.js";

export async function POST(request) {
  // Require authentication
  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    return unauthorizedResponse();
  }

  const response = NextResponse.json({ success: true, message: "Shutting down..." });

  setTimeout(() => {
    process.exit(0);
  }, 500);

  return response;
}

