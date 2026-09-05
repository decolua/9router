import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { cookies } from "next/headers";
import { isLocalRequest } from "@/dashboardGuard";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import bcrypt from "bcryptjs";

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.` },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const { currentPassword, newPassword } = await request.json();
    const settings = await getSettings();

    // Block tunnel/tailscale bootstrap if dashboard access is disabled
    const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
    const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
    const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
    const isTunnelRequest = (tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost);
    if (isTunnelRequest && settings.tunnelDashboardAccess !== true) {
      return NextResponse.json({ error: "Dashboard access via tunnel is disabled" }, { status: 403 });
    }

    // Must be a fresh install: no password, no INITIAL_PASSWORD, not local.
    // Matches the gate in login/route.js
    if (settings.password || process.env.INITIAL_PASSWORD || isLocalRequest(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // First-time setup: no current hash exists, so the only valid current
    // password is the default (or none). Same semantics as the settings PATCH
    // first-time branch.
    const initialPassword = process.env.INITIAL_PASSWORD || "123456";
    if (currentPassword && currentPassword !== initialPassword) {
      const { remainingBeforeLock } = recordFail(ip);
      return NextResponse.json(
        { error: `Invalid current password. ${remainingBeforeLock} attempt(s) left before lockout.` },
        { status: 401 }
      );
    }

    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return NextResponse.json({ error: "New password must be at least 6 characters" }, { status: 400 });
    }

    const salt = await bcrypt.genSalt(10);
    const password = await bcrypt.hash(newPassword, salt);
    await updateSettings({ password });
    recordSuccess(ip);

    const cookieStore = await cookies();
    await setDashboardAuthCookie(cookieStore, request);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
