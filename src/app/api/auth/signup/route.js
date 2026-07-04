import { NextResponse } from "next/server";
import { getSettings, countUsers, consumeInvite, createUser } from "@/lib/localDb";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { validatePassword } from "@/lib/auth/passwordPolicy";
import { auditFromRequest, AuditAction } from "@/lib/audit";
import { requireOrgFromRequest, runWithRequestOrg } from "@/lib/org/orgContext.js";
import { isSaas } from "@/lib/deploy/deployMode.js";
import { getOrganizationById } from "@/lib/db/repos/organizationsRepo.js";

export async function POST(request) {
  return runWithRequestOrg(request, async () => {
    try {
      const { org, error: orgError } = await requireOrgFromRequest(request);
      if (orgError) return orgError;

      const settings = await getSettings(org.id);
      const body = await request.json();
      const { inviteToken, email, name, password } = body;

      const normalizedEmail = String(email || "").trim().toLowerCase();
      if (!normalizedEmail || !password) {
        return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
      }
      const passwordCheck = validatePassword(password);
      if (!passwordCheck.ok) {
        return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
      }

      const userCount = await countUsers(org.id);
      let user;

      if (userCount === 0) {
        if (isSaas()) {
          return NextResponse.json(
            { error: "Register your organization first", registerUrl: "/register" },
            { status: 403 },
          );
        }
        user = await createUser({
          orgId: org.id,
          email: normalizedEmail,
          name: name || normalizedEmail.split("@")[0],
          password,
          role: "admin",
        });
      } else if (inviteToken) {
        user = await consumeInvite(inviteToken, {
          email: normalizedEmail,
          name: name || normalizedEmail.split("@")[0],
          password,
          orgId: org.id,
        });
      } else if (settings.signupMode === "open") {
        user = await createUser({
          orgId: org.id,
          email: normalizedEmail,
          name: name || normalizedEmail.split("@")[0],
          password,
          role: "member",
        });
      } else {
        return NextResponse.json({ error: "An invite token is required to create an account" }, { status: 403 });
      }

      const orgRecord = await getOrganizationById(org.id);
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request, {
        userId: user.id,
        orgId: user.orgId,
        orgSlug: orgRecord?.slug,
        role: user.role,
        email: user.email,
        name: user.name,
      });

      await auditFromRequest(request, {
        action: AuditAction.USER_CREATED,
        actorUserId: user.id,
        actorEmail: user.email,
        targetType: "user",
        targetId: user.id,
        meta: { role: user.role, bootstrap: userCount === 0, orgId: org.id },
      });

      return NextResponse.json({ success: true, user }, { status: 201 });
    } catch (error) {
      return NextResponse.json({ error: error.message || "Signup failed" }, { status: 400 });
    }
  });
}
