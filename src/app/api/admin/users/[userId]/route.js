import { NextResponse } from "next/server";
import { getUserById, updateUser } from "@/lib/localDb";
import { requireAdmin } from "@/lib/auth/helpers";
import { notifyUserApproved } from "@/lib/email";

/**
 * PATCH /api/admin/users/[userId]
 * Update a user (e.g. set status to 'active' to approve pending registration).
 */
export async function PATCH(request, { params }) {
  try {
    requireAdmin(request);
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    }

    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const updates = {};
    if (body.status !== undefined) {
      if (!["pending", "active"].includes(body.status)) {
        return NextResponse.json(
          { error: "status must be 'pending' or 'active'" },
          { status: 400 }
        );
      }
      updates.status = body.status;
    }
    if (body.isAdmin !== undefined) updates.isAdmin = !!body.isAdmin;
    if (body.displayName !== undefined) updates.displayName = String(body.displayName).trim() || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const wasPending = (user.status ?? "active") === "pending";
    const approvedToActive = wasPending && body.status === "active";

    const updated = await updateUser(userId, updates);

    if (approvedToActive && updated.email) {
      notifyUserApproved({
        email: updated.email,
        displayName: updated.displayName,
      }).catch((err) => console.error("[admin/users] Approval notify failed:", err));
    }

    return NextResponse.json({
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      isAdmin: updated.isAdmin,
      status: updated.status ?? "active",
      createdAt: updated.createdAt,
      lastLoginAt: updated.lastLoginAt,
    });
  } catch (error) {
    const status =
      error.message === "Admin access required" ||
      error.message === "Authentication required"
        ? 403
        : 500;
    return NextResponse.json(
      { error: error.message || "Update failed" },
      { status }
    );
  }
}
