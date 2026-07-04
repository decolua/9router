import { NextResponse } from "next/server";
import { isSaas } from "@/lib/deploy/deployMode.js";
import { normalizeOrgSlug, validateOrgSlug } from "@/lib/org/slug.js";
import { buildOrgDashboardUrl } from "@/lib/org/orgContext.js";
import { createOrganization, isSlugAvailable } from "@/lib/db/repos/organizationsRepo.js";
import { createOrgSettings } from "@/lib/db/repos/settingsRepo.js";
import { createUser } from "@/lib/db/repos/usersRepo.js";
import { validatePassword } from "@/lib/auth/passwordPolicy";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export async function POST(request) {
  if (!isSaas()) {
    return NextResponse.json({ error: "Organization registration is only available in SaaS mode" }, { status: 404 });
  }

  try {
    const body = await request.json();
    const orgName = String(body.orgName || body.name || "").trim();
    const orgSlug = normalizeOrgSlug(body.orgSlug || body.slug || orgName);
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || body.adminName || email.split("@")[0] || "").trim();
    const password = body.password;

    if (!orgName || !orgSlug || !email || !password) {
      return NextResponse.json({ error: "Organization name, slug, email, and password are required" }, { status: 400 });
    }

    const slugCheck = validateOrgSlug(orgSlug);
    if (!slugCheck.ok) {
      return NextResponse.json({ error: slugCheck.error }, { status: 400 });
    }

    if (!(await isSlugAvailable(orgSlug))) {
      return NextResponse.json({ error: "This organization URL is already taken" }, { status: 409 });
    }

    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const org = await createOrganization({ slug: orgSlug, name: orgName });
    await createOrgSettings(org.id, {
      multiUserEnabled: true,
      signupMode: "invite",
      requireLogin: true,
    });

    const user = await createUser({
      orgId: org.id,
      email,
      name,
      password,
      role: "admin",
    });

    await auditFromRequest(request, {
      action: AuditAction.USER_CREATED,
      actorUserId: user.id,
      actorEmail: user.email,
      targetType: "organization",
      targetId: org.id,
      meta: { slug: org.slug, bootstrap: true },
    });

    return NextResponse.json({
      success: true,
      organization: { id: org.id, slug: org.slug, name: org.name },
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      loginUrl: buildOrgDashboardUrl(org.slug, "/login"),
      dashboardUrl: buildOrgDashboardUrl(org.slug, "/dashboard"),
    }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Registration failed" }, { status: 400 });
  }
}
