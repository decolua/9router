import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isCasConfigured } from "@/lib/auth/cas";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const oidcName = String(session?.oidcName || "").trim();
    const oidcEmail = String(session?.oidcEmail || "").trim();
    const casName = String(session?.casName || "").trim();
    const casEmail = String(session?.casEmail || "").trim();
    const displayName = oidcName || oidcEmail || casName || casEmail || (session?.oidc ? "OIDC user" : session?.cas ? "CAS user" : "Password user");
    const loginMethod = session?.oidc ? "OIDC" : session?.cas ? "CAS" : "Password";

    return NextResponse.json({
      requireLogin,
      authMode,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      casConfigured: isCasConfigured(settings),
      casLoginLabel: (settings.casLoginLabel || "Sign in with CAS").trim() || "Sign in with CAS",
      hasPassword: !!settings.password,
      displayName,
      loginMethod,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
      casName: casName || null,
      casEmail: casEmail || null,
      casLogin: !!session?.cas,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      casConfigured: false,
      casLoginLabel: "Sign in with CAS",
      hasPassword: false,
      displayName: "Password user",
      loginMethod: "Password",
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
      casName: null,
      casEmail: null,
      casLogin: false,
    });
  }
}
