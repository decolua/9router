import { NextResponse } from "next/server";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";
import { verifySecondFactor, isMfaEnabledNow, disableMfa } from "@/lib/auth/mfa";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/** Turn MFA off. Requires BOTH the current password and a live second factor. */
export async function POST(request) {
  try {
    if (!(await isMfaEnabledNow())) {
      return NextResponse.json(
        { error: "MFA is not enabled" },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter), ...NO_STORE_HEADERS } },
      );
    }

    const { password, code } = await request.json();

    if (!(await verifyDashboardPassword(password))) {
      recordFail(ip);
      return NextResponse.json(
        { error: "Invalid password" },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    // Requiring the second factor here too means a stolen session + known
    // password still cannot strip MFA off the account.
    const result = await verifySecondFactor(code);
    if (!result.ok) {
      const { remainingBeforeLock } = recordFail(ip);
      return NextResponse.json(
        { error: `Invalid code. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    recordSuccess(ip);
    await disableMfa();

    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
