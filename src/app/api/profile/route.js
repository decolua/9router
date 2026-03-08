import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth/getUserIdFromRequest";
import { getUserById } from "@/lib/localDb";

/**
 * GET /api/profile
 * Returns current user's safe profile (no password hash).
 * Used by profile page to know if user has password (set vs change flow).
 */
export async function GET(request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: user.id,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      hasPassword: !!user.passwordHash,
      isAdmin: !!user.isAdmin,
    });
  } catch (error) {
    console.error("Profile GET error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
