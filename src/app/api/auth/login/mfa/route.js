import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { getUserById } from "@/lib/db/repos/usersRepo.js";
import { getOrganizationById } from "@/lib/db/repos/organizationsRepo.js";
import { auditFromRequest, AuditAction } from "@/lib/audit";
import { verifyMfaChallengeToken, verifyMfaCode } from "@/lib/auth/mfa";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const { mfaToken, code } = await request.json();
    if (!mfaToken || !code) {
      return NextResponse.json({ error: "MFA token and code are required" }, { status: 400 });
    }

    const challenge = await verifyMfaChallengeToken(mfaToken);
    if (!challenge?.userId) {
      return NextResponse.json({ error: "MFA session expired. Sign in again." }, { status: 401 });
    }

    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const ok = await verifyMfaCode(challenge.userId, code);
    if (!ok) {
      recordFail(ip);
      return NextResponse.json({ error: "Invalid verification code" }, { status: 401 });
    }

    recordSuccess(ip);
    const user = await getUserById(challenge.userId);
    if (!user || user.status !== "active") {
      return NextResponse.json({ error: "Account unavailable" }, { status: 403 });
    }

    const orgRecord = user.orgId ? await getOrganizationById(user.orgId) : null;
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
      meta: { mfa: true },
    });

    return NextResponse.json({ success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
