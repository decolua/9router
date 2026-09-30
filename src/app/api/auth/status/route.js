import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { firstAllowedPage, normalizePermissions, FULL_PERMISSIONS, DEFAULT_PERMISSIONS } from "@/lib/auth/permissionPaths";

export async function GET() {
  try {
    const settings = await getSettings();
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    const requireLogin = settings.requireLogin !== false;
    const authMode = settings.authMode || "password";
    const ssoType = settings.ssoType || "oidc";
    const oidcName = String(session?.oidcName || "").trim();
    const oidcEmail = String(session?.oidcEmail || "").trim();
    const samlName = String(session?.samlName || "").trim();
    const samlEmail = String(session?.samlEmail || "").trim();

    const role = session?.role || "admin";
    // A password session is a full admin. Anything else carries exactly what its
    // key holds, normalized so a key stored before a permission existed simply
    // lacks it rather than inheriting one.
    const permissions = session?.permissions
      ? normalizePermissions(session.permissions)
      : (role === "admin" ? FULL_PERMISSIONS : DEFAULT_PERMISSIONS);
    const isApiKeyLogin = role === "apikey";

    const displayName =
      samlName ||
      samlEmail ||
      oidcName ||
      oidcEmail ||
      (isApiKeyLogin ? (session?.keyName || "API Key user") : session?.saml ? "SAML user" : session?.oidc ? "OIDC user" : "Password user");

    const loginMethod = isApiKeyLogin ? "API Key" : session?.saml ? "SAML" : session?.oidc ? "OIDC" : "Password";
    // Where this session belongs after signing in. A key without any usable
    // permission gets null so the login page can stop instead of redirecting in a loop.
    const homePath = isApiKeyLogin && session ? firstAllowedPage(permissions) : "/dashboard";

    return NextResponse.json({
      requireLogin,
      authMode,
      ssoType,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      samlConfigured: isSamlConfigured(settings),
      samlLoginLabel: (settings.samlLoginLabel || "Sign in with SAML SSO").trim() || "Sign in with SAML SSO",
      hasPassword: !!settings.password,
      displayName,
      loginMethod,
      authenticated: !!session,
      role,
      permissions,
      homePath,
      apiKey: session?.apiKey || null,
      keyId: session?.keyId || null,
      allowedModels: session?.allowedModels || "*",
      tokenLimit: session?.tokenLimit || 0,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
      samlName: samlName || null,
      samlEmail: samlEmail || null,
      samlLogin: !!session?.saml,
    });
  } catch {
    return NextResponse.json({
      requireLogin: true,
      authMode: "password",
      ssoType: "oidc",
      oidcConfigured: false,
      oidcLoginLabel: "Sign in with OIDC",
      samlConfigured: false,
      samlLoginLabel: "Sign in with SAML SSO",
      hasPassword: false,
      displayName: "Password user",
      loginMethod: "Password",
      authenticated: false,
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
      samlName: null,
      samlEmail: null,
      samlLogin: false,
    });
  }
}
