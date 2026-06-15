import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings, countUsers } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserById, getUserByEmail } from "@/lib/db/repos/usersRepo.js";

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const userCount = await countUsers();

    let currentUser = null;
    if (session?.userId) {
      currentUser = await getUserById(session.userId);
    }

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
      currentUser: currentUser
        ? { id: currentUser.id, email: currentUser.email, name: currentUser.name, role: currentUser.role }
        : null,
    });
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
      currentUser: null,
    });
  }
}
