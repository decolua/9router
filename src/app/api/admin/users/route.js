import { NextResponse } from "next/server";
import { getUsers } from "@/lib/localDb";
import { requireAdmin, getUserFromRequest } from "@/lib/auth/helpers";

export async function GET(request) {
  try {
    // Verify admin access
    const admin = requireAdmin(request);
    
    // Get all users
    const users = await getUsers();
    
    // Return user list (excluding sensitive fields)
    const userList = users.map(user => ({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      oauthProvider: user.oauthProvider,
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    }));
    
    return NextResponse.json(userList);
  } catch (error) {
    console.error("[API] Failed to get users:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch users" },
      { status: error.message === "Admin access required" || error.message === "Authentication required" ? 401 : 500 }
    );
  }
}
