import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import { isOidcConfigured } from "@/lib/auth/oidc";
import { isSamlConfigured } from "@/lib/auth/saml.js";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getPasskeyLoginState } from "@/lib/auth/passkeyMode";
import { isLocalRequest } from "@/dashboardGuard";

export async function GET(request) {
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
    const passkeyName = String(session?.passkeyName || "").trim();

    // Only booleans and the mode leave this public endpoint — never the passkey count.
    const passkey = await getPasskeyLoginState(settings);
    const passwordLoginAllowed = !(passkey.effectiveMode === "only" && !(request && isLocalRequest(request)));

    const displayName =
      samlName ||
      samlEmail ||
      oidcName ||
      oidcEmail ||
      passkeyName ||
      (session?.saml ? "SAML user" : session?.oidc ? "OIDC user" : session?.passkey ? "Passkey user" : "Password user");

    const loginMethod = session?.saml ? "SAML" : session?.oidc ? "OIDC" : session?.passkey ? "Passkey" : "Password";

    return NextResponse.json({
      requireLogin,
      authMode,
      ssoType,
      oidcConfigured: isOidcConfigured(settings),
      oidcLoginLabel: (settings.oidcLoginLabel || "Sign in with OIDC").trim() || "Sign in with OIDC",
      samlConfigured: isSamlConfigured(settings),
      samlLoginLabel: (settings.samlLoginLabel || "Sign in with SAML SSO").trim() || "Sign in with SAML SSO",
      hasPassword: !!settings.password,
      passkeyMode: passkey.effectiveMode,
      passkeyAvailable: passkey.available,
      passwordLoginAllowed,
      displayName,
      loginMethod,
      authenticated: !!session,
      oidcName: oidcName || null,
      oidcEmail: oidcEmail || null,
      oidcLogin: !!session?.oidc,
      samlName: samlName || null,
      samlEmail: samlEmail || null,
      samlLogin: !!session?.saml,
      passkeyLogin: !!session?.passkey,
    }, { headers: { "Cache-Control": "no-store" } });
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
      passkeyMode: "off",
      passkeyAvailable: false,
      passwordLoginAllowed: true,
      displayName: "Password user",
      loginMethod: "Password",
      authenticated: false,
      oidcName: null,
      oidcEmail: null,
      oidcLogin: false,
      samlName: null,
      samlEmail: null,
      samlLogin: false,
      passkeyLogin: false,
    }, { headers: { "Cache-Control": "no-store" } });
  }
}
