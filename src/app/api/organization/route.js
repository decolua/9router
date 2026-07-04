import { NextResponse } from "next/server";
import { withAdminUser } from "@/lib/auth/runtimeUserContext.js";
import { getOrganizationById } from "@/lib/db/repos/organizationsRepo.js";
import { countUsers } from "@/lib/db/repos/usersRepo.js";
import { getSettings, updateSettings } from "@/lib/localDb";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = withAdminUser(async (_request, _ctx, user) => {
  try {
    const org = await getOrganizationById(user.orgId);
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

    const [settings, memberCount] = await Promise.all([
      getSettings(org.id),
      countUsers(org.id),
    ]);

    return NextResponse.json({
      organization: org,
      memberCount,
      signupMode: settings.signupMode || "invite",
      multiUserEnabled: settings.multiUserEnabled !== false,
      requireLogin: settings.requireLogin !== false,
      authMode: settings.authMode || "password",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});

export const PATCH = withAdminUser(async (request, _ctx, user) => {
  try {
    const org = await getOrganizationById(user.orgId);
    if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

    const body = await request.json();
    const allowed = {};
    if (body.signupMode && ["invite", "open", "closed"].includes(body.signupMode)) {
      allowed.signupMode = body.signupMode;
    }
    if (typeof body.multiUserEnabled === "boolean") {
      allowed.multiUserEnabled = body.multiUserEnabled;
    }
    if (typeof body.requireLogin === "boolean") {
      allowed.requireLogin = body.requireLogin;
    }

    if (!Object.keys(allowed).length) {
      return NextResponse.json({ error: "No valid settings to update" }, { status: 400 });
    }

    const settings = await updateSettings(allowed, org.id);
    await auditFromRequest(request, {
      action: AuditAction.SETTINGS_CHANGED,
      actorUserId: user.id,
      actorEmail: user.email,
      targetType: "organization",
      targetId: org.id,
      meta: { keys: Object.keys(allowed) },
    });

    return NextResponse.json({
      organization: org,
      signupMode: settings.signupMode,
      multiUserEnabled: settings.multiUserEnabled,
      requireLogin: settings.requireLogin,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
