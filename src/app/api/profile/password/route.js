import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/auth/getUserIdFromRequest";
import { getUserById, updateUser } from "@/lib/localDb";
import bcrypt from "bcryptjs";

const MIN_PASSWORD_LENGTH = 8;

/**
 * PATCH /api/profile/password
 * Set or change current user's password (per-user).
 * - No current password yet: allow setting new password without current.
 * - Has password: require current password to change.
 */
export async function PATCH(request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const user = await getUserById(userId);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!newPassword || typeof newPassword !== "string") {
      return NextResponse.json(
        { error: "New password is required" },
        { status: 400 }
      );
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    if (user.passwordHash) {
      if (!currentPassword || typeof currentPassword !== "string") {
        return NextResponse.json(
          { error: "Current password is required to change password" },
          { status: 400 }
        );
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid current password" },
          { status: 401 }
        );
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    await updateUser(userId, { passwordHash });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Profile password PATCH error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
