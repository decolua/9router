import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getSettings, updateSettings } from "@/lib/localDb";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";
import {
  getAuthBootstrapState,
  validateNewPassword,
  MIN_PASSWORD_LENGTH,
} from "@/lib/auth/setupState";
import { consumeSetupToken, getSetupTokenState, SETUP_WINDOW_MS } from "@/lib/auth/setupToken";
import { ensureSetupToken } from "@/lib/auth/setupBootstrap";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const EXPIRED_MESSAGE =
  "Setup window expired. Restart 10router on the host to get a new setup token.";

export async function GET() {
  const state = await getAuthBootstrapState();
  // Startup normally mints the token, but Next may not have booted the app
  // module yet when this route is hit first. ensureSetupToken mints at most
  // once per process, so this cannot be used to refresh an expiring window —
  // only a real restart reopens it.
  if (state === "setup") {
    await ensureSetupToken();
  }
  const token = getSetupTokenState();
  return NextResponse.json(
    {
      needsSetup: state === "setup",
      locked: state === "setup" && (!token.present || token.expired),
      expiresInSec: token.expiresInSec,
      windowMinutes: Math.round(SETUP_WINDOW_MS / 60000),
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
    { headers: NO_STORE_HEADERS }
  );
}

export async function POST(request) {
  try {
    const ip = getClientIp(request);
    const lock = checkLock(ip);
    if (lock.locked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${lock.retryAfter}s.`, retryAfter: lock.retryAfter },
        { status: 429, headers: { "Retry-After": String(lock.retryAfter) } }
      );
    }

    const settings = await getSettings();
    const state = await getAuthBootstrapState(settings);
    if (state !== "setup") {
      return NextResponse.json(
        { error: "Setup already completed.", needsSetup: false },
        { status: 409, headers: NO_STORE_HEADERS }
      );
    }

    const { token, password } = await request.json();

    // Validate the password first: consuming the token is irreversible, so a
    // too-short password must not burn it.
    const check = validateNewPassword(password);
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const verified = consumeSetupToken(token);
    if (!verified.ok) {
      if (verified.reason === "expired" || verified.reason === "missing") {
        return NextResponse.json({ error: EXPIRED_MESSAGE, locked: true }, { status: 403, headers: NO_STORE_HEADERS });
      }
      const { remainingBeforeLock } = recordFail(ip);
      return NextResponse.json(
        { error: `Invalid setup token. ${remainingBeforeLock} attempt(s) left before lockout.`, remainingBeforeLock },
        { status: 401, headers: NO_STORE_HEADERS }
      );
    }

    const hash = await bcrypt.hash(password, await bcrypt.genSalt(10));
    // requireLogin is forced back on: an instance being claimed for the first
    // time must not come up with authentication disabled.
    await updateSettings({ password: hash, requireLogin: true });
    recordSuccess(ip);

    const cookieStore = await cookies();
    await setDashboardAuthCookie(cookieStore, request);

    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
