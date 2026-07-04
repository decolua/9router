import { NextResponse } from "next/server";
import { verifyUserPassword } from "@/lib/localDb";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import { getSettings } from "@/lib/localDb";
import { auditFromRequest, AuditAction } from "@/lib/audit";
import { isMfaRequired, createMfaChallengeToken } from "@/lib/auth/mfa";
import { requireOrgFromRequest, runWithRequestOrg } from "@/lib/org/orgContext.js";
import { getOrganizationById } from "@/lib/db/repos/organizationsRepo.js";

const RESET_HINT = "Use Forgot password below, or contact your org admin for a reset link.";

function isTunnelRequest(request, settings) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
  const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
  const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
  return (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
}

export async function POST(request) {
  return runWithRequestOrg(request, async () => {
    try {
      const { org, error: orgError } = await requireOrgFromRequest(request);
      if (orgError) return orgError;

      const ip = getClientIp(request);
      const lock = checkLock(ip);
      if (lock.locked) {
        return NextResponse.json(
          { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter, resetHint: RESET_HINT },
          { status: 429, headers: { "Retry-After": String(lock.retryAfter) } },
        );
      }

      const { email, password } = await request.json();
      const settings = await getSettings(org.id);

      if (isTunnelRequest(request, settings) && settings.tunnelDashboardAccess !== true) {
        return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
      }

      if (settings.authMode === "oidc" && isOidcConfigured(settings)) {
        return NextResponse.json({ error: "Password login is disabled. Use OIDC sign in." }, { status: 403 });
      }

      const normalizedEmail = String(email || "").trim().toLowerCase();
      if (!normalizedEmail || !password) {
        return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
      }

      const user = await verifyUserPassword(normalizedEmail, password, org.id);
      if (user) {
        recordSuccess(ip);
        if (await isMfaRequired(user.id)) {
          const mfaToken = await createMfaChallengeToken(user.id);
          return NextResponse.json({ mfaRequired: true, mfaToken });
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
          action: AuditAction.LOGIN_SUCCESS,
          actorUserId: user.id,
          actorEmail: user.email,
          targetType: "user",
          targetId: user.id,
          outcome: "success",
          meta: { orgId: org.id },
        });
        return NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.orgId } });
      }

      await auditFromRequest(request, {
        action: AuditAction.LOGIN_FAILURE,
        actorEmail: normalizedEmail,
        targetType: "user",
        outcome: "failure",
        meta: { orgId: org.id },
      });

      const { remainingBeforeLock } = recordFail(ip);
      const postLock = checkLock(ip);
      if (postLock.locked) {
        return NextResponse.json(
          { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s.`, retryAfter: postLock.retryAfter, resetHint: RESET_HINT },
          { status: 429, headers: { "Retry-After": String(postLock.retryAfter) } },
        );
      }
      return NextResponse.json(
        { error: `Invalid email or password. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock, resetHint: RESET_HINT },
        { status: 401 },
      );
    } catch (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  });
}
