import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  MFA_PENDING_COOKIE,
  getMfaPendingSession,
  setDashboardAuthCookie,
  clearMfaPendingCookie,
} from "@/lib/auth/dashboardSession";
import { verifySecondFactor } from "@/lib/auth/mfa";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

/** Login step 2: trade a valid second factor for a real dashboard session. */
export async function POST(request) {
  try {
    const ip = getClientIp(request);

    // Share the password limiter: TOTP has only 10^6 values, so an unthrottled
    // endpoint is the weak point of the whole scheme.
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter), ...NO_STORE_HEADERS } },
      );
    }

    const cookieStore = await cookies();
    const pending = await getMfaPendingSession(cookieStore.get(MFA_PENDING_COOKIE)?.value);
    if (!pending) {
      return NextResponse.json(
        { error: "MFA session expired. Sign in again." },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const { code } = await request.json();
    const result = await verifySecondFactor(code);

    if (!result.ok) {
      const { remainingBeforeLock } = recordFail(ip);
      const postLock = checkLock(ip);
      if (postLock.locked) {
        return NextResponse.json(
          { error: `Too many failed attempts. Try again in ${postLock.retryAfter}s.`, retryAfter: postLock.retryAfter },
          { status: 429, headers: { "Retry-After": String(postLock.retryAfter), ...NO_STORE_HEADERS } },
        );
      }
      return NextResponse.json(
        { error: `Invalid code. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    recordSuccess(ip);
    clearMfaPendingCookie(cookieStore);
    await setDashboardAuthCookie(cookieStore, request, { mfa: result.method });

    return NextResponse.json(
      {
        success: true,
        method: result.method,
        backupCodesRemaining: result.backupCodesRemaining,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
