import { NextResponse } from "next/server";
import { getUsers } from "@/lib/localDb";
import { getUsageStats } from "@/lib/usageDb";
import { requireAdmin } from "@/lib/auth/helpers";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    requireAdmin(request);

    const users = await getUsers();

    const userList = await Promise.all(
      users.map(async (user) => {
        let usageSummary = { requests7d: 0, cost7d: 0 };
        try {
          const stats = await getUsageStats("7d", user.id);
          usageSummary = {
            requests7d: stats.totalRequests ?? 0,
            cost7d: stats.totalCost ?? 0,
          };
        } catch {
          // Ignore per-user usage fetch errors
        }
        return {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          oauthProvider: user.oauthProvider,
          isAdmin: user.isAdmin,
          status: user.status ?? "active",
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          usageSummary,
        };
      })
    );

    return NextResponse.json(userList);
  } catch (error) {
    console.error("[API] Failed to get users:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch users" },
      { status: error.message === "Admin access required" || error.message === "Authentication required" ? 401 : 500 }
    );
  }
}
