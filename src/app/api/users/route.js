import { NextResponse } from "next/server";
import { getSettings, getUsers, createInvite, setUserStatus, deleteUser } from "@/lib/localDb";
import { setUserRole } from "@/lib/db/repos/usersRepo.js";
import { withAdminUser } from "@/lib/auth/runtimeUserContext.js";
import { auditFromRequest, AuditAction } from "@/lib/audit";
import { createPasswordResetToken } from "@/lib/auth/passwordReset";
import { isSmtpConfigured } from "@/lib/email/smtp";

export const dynamic = "force-dynamic";

export const GET = withAdminUser(async () => {
  try {
    const users = await getUsers();
    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const POST = withAdminUser(async (request, _ctx, admin) => {
  try {
    const settings = await getSettings();
    if (settings.signupMode === "closed") {
      return NextResponse.json({ error: "User invites are disabled" }, { status: 403 });
    }

    const body = await request.json();
    const { email, role = "member", expiresInHours = 168 } = body;

    const invite = await createInvite({
      email: email || null,
      role,
      createdBy: admin.id,
      expiresInHours,
    });

    const origin = process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
    const signupUrl = origin
      ? `${origin.replace(/\/+$/, "")}/signup?token=${encodeURIComponent(invite.token)}`
      : null;

    await auditFromRequest(request, {
      action: AuditAction.INVITE_CREATED,
      actorUserId: admin.id,
      actorEmail: admin.email,
      targetType: "invite",
      targetId: invite.id,
      meta: { email: invite.email, role: invite.role },
    });

    return NextResponse.json({
      inviteId: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
      signupUrl,
      token: invite.token,
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});

export const PATCH = withAdminUser(async (request, _ctx, admin) => {
  try {
    const body = await request.json();
    const { id, status, role } = body;
    if (!id) return NextResponse.json({ error: "User id is required" }, { status: 400 });
    if (id === admin.id && status === "disabled") {
      return NextResponse.json({ error: "You cannot disable your own account" }, { status: 400 });
    }

    let user;
    if (status !== undefined) {
      user = await setUserStatus(id, status);
      await auditFromRequest(request, {
        action: AuditAction.USER_STATUS_CHANGED,
        actorUserId: admin.id,
        actorEmail: admin.email,
        targetType: "user",
        targetId: id,
        meta: { status },
      });
    }

    if (role !== undefined) {
      if (id === admin.id && role !== "admin") {
        return NextResponse.json({ error: "You cannot demote your own admin role" }, { status: 400 });
      }
      const before = user || (await getUsers()).find((u) => u.id === id);
      user = await setUserRole(id, role);
      await auditFromRequest(request, {
        action: AuditAction.USER_ROLE_CHANGED,
        actorUserId: admin.id,
        actorEmail: admin.email,
        targetType: "user",
        targetId: id,
        meta: { from: before?.role, to: role },
      });
    }

    if (!user) return NextResponse.json({ error: "No changes requested" }, { status: 400 });
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});

export const PUT = withAdminUser(async (request, _ctx, admin) => {
  try {
    const body = await request.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: "User id is required" }, { status: 400 });

    const users = await getUsers();
    const target = users.find((u) => u.id === id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const result = await createPasswordResetToken(target.email, { createdBy: admin.id });
    if (!result.user) {
      return NextResponse.json({ error: "User not found or password login not available" }, { status: 404 });
    }

    await auditFromRequest(request, {
      action: AuditAction.PASSWORD_RESET_REQUESTED,
      actorUserId: admin.id,
      actorEmail: admin.email,
      targetType: "user",
      targetId: result.user.id,
      meta: { issuedByAdmin: true, smtpConfigured: isSmtpConfigured() },
    });

    return NextResponse.json({
      success: true,
      resetUrl: result.resetUrl,
      emailed: isSmtpConfigured(),
      message: isSmtpConfigured()
        ? "Reset link emailed to the user."
        : "SMTP not configured — share this one-time reset URL securely with the user.",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});

export const DELETE = withAdminUser(async (request, _ctx, admin) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "User id is required" }, { status: 400 });
    if (id === admin.id) {
      return NextResponse.json({ error: "You cannot delete your own account" }, { status: 400 });
    }
    await deleteUser(id);
    await auditFromRequest(request, {
      action: AuditAction.USER_DELETED,
      actorUserId: admin.id,
      actorEmail: admin.email,
      targetType: "user",
      targetId: id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});
