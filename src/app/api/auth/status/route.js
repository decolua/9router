import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings, countUsers } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserByEmail } from "@/lib/db/repos/usersRepo.js";
import { getSessionUser } from "@/lib/auth/requestContext.js";

const STATUS_RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    const session = await getDashboardAuthSession(token);
    const currentUser = await getSessionUser(token);
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const userCount = await countUsers();

    const oidcName = String(session?.oidcName || currentUser?.name || "").trim();
    const oidcEmail = String(session?.oidcEmail || currentUser?.email || "").trim();
    const displayName = oidcName || oidcEmail || "User";
    const loginMethod = session?.oidc ? "OIDC" : "Password";

    let hasPassword = false;
    if (currentUser?.email) {
      const full = await getUserByEmail(currentUser.email);
      hasPassword = !!full?.passwordHash;
    }

    return NextResponse.json({
      requireLogin,
      authMode,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      hasPassword,
      displayName,
      loginMethod,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
      multiUserEnabled: settings.multiUserEnabled !== false,
      signupMode: settings.signupMode || "invite",
      userCount,
      isAdmin: currentUser?.role === "admin",
      currentUser: currentUser
        ? { id: currentUser.id, email: currentUser.email, name: currentUser.name, role: currentUser.role }
        : null,
    }, { headers: STATUS_RESPONSE_HEADERS });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      hasPassword: false,
      displayName: "User",
      loginMethod: "Password",
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
      multiUserEnabled: true,
      signupMode: "invite",
      userCount: 0,
      isAdmin: false,
      currentUser: null,
    }, { headers: STATUS_RESPONSE_HEADERS });
  }
}
