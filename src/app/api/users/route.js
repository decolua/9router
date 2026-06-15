import { NextResponse } from "next/server";
import { getSettings, getUsers, createInvite, setUserStatus, deleteUser } from "@/lib/localDb";
import { withAdminUser } from "@/lib/auth/runtimeUserContext.js";
import { auditFromRequest, AuditAction } from "@/lib/audit";

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
    const { id, status } = body;
    if (!id) return NextResponse.json({ error: "User id is required" }, { status: 400 });
    if (id === admin.id && status === "disabled") {
      return NextResponse.json({ error: "You cannot disable your own account" }, { status: 400 });
    }
    const user = await setUserStatus(id, status);
    await auditFromRequest(request, {
      action: AuditAction.USER_STATUS_CHANGED,
      actorUserId: admin.id,
      actorEmail: admin.email,
      targetType: "user",
      targetId: id,
      meta: { status },
    });
    return NextResponse.json({ user });
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
