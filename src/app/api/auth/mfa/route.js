import { NextResponse } from "next/server";
import { withAuthUser } from "@/lib/auth/runtimeUserContext.js";
import { beginMfaSetup, confirmMfaSetup, disableMfa } from "@/lib/auth/mfa";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export const POST = withAuthUser(async (request, _ctx, user) => {
  try {
    const body = await request.json();
    const action = body.action || "setup";

    if (action === "setup") {
      const setup = await beginMfaSetup(user.id, user.email);
      return NextResponse.json({
        otpauthUri: setup.otpauthUri,
        secret: setup.secret,
      });
    }

    if (action === "confirm") {
      await confirmMfaSetup(user.id, body.code);
      await auditFromRequest(request, {
        action: AuditAction.MFA_ENABLED,
        actorUserId: user.id,
        actorEmail: user.email,
        targetType: "user",
        targetId: user.id,
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});

export const DELETE = withAuthUser(async (request, _ctx, user) => {
  try {
    const body = await request.json();
    await disableMfa(user.id, body.code);
    await auditFromRequest(request, {
      action: AuditAction.MFA_DISABLED,
      actorUserId: user.id,
      actorEmail: user.email,
      targetType: "user",
      targetId: user.id,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
});
