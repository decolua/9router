import { audit, sessionActor } from "@/lib/observability/audit";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  exchangeOidcCode,
  fetchOidcDiscovery,
  getOidcRuntimeConfig,
  getPublicOrigin,
  pickOidcDisplayName,
  pickOidcEmail,
  verifyOidcIdToken,
} from "@/lib/auth/oidc";
import { ssoRole } from "@/lib/auth/dashboardRoles";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";

function clearOidcCookies(cookieStore) {
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
}

async function callback(request, outcome) {
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, getPublicOrigin(request)));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(new URL("/login?error=oidc_missing_code", getPublicOrigin(request)));
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("oidc_state")?.value;
  const storedNonce = cookieStore.get("oidc_nonce")?.value;
  const codeVerifier = cookieStore.get("oidc_code_verifier")?.value;

  if (!storedState || !storedNonce || !codeVerifier || storedState !== state) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL("/login?error=oidc_invalid_state", getPublicOrigin(request)));
  }

  try {
    const config = await getOidcRuntimeConfig();
    if (!config) {
      clearOidcCookies(cookieStore);
      return NextResponse.redirect(new URL("/login?error=oidc_not_configured", getPublicOrigin(request)));
    }

    const discovery = await fetchOidcDiscovery(config.issuerUrl);
    const discoveredIssuer = discovery.issuer || config.issuerUrl;
    const redirectUri = `${getPublicOrigin(request)}/api/auth/oidc/callback`;
    const tokenData = await exchangeOidcCode({
      tokenEndpoint: discovery.token_endpoint,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code,
      redirectUri,
      codeVerifier,
    });

    if (!tokenData.id_token) {
      throw new Error("OIDC provider did not return an id_token");
    }

    const payload = await verifyOidcIdToken({
      idToken: tokenData.id_token,
      issuer: discoveredIssuer,
      audience: config.clientId,
      jwksUri: discovery.jwks_uri,
      nonce: storedNonce,
    });

    clearOidcCookies(cookieStore);
    const claims = {
      role: ssoRole(config, payload.email_verified === true ? payload.email : null, payload.groups),
      oidc: true,
      oidcSub: payload.sub || null,
      oidcEmail: pickOidcEmail(payload) || null,
      oidcName: pickOidcDisplayName(payload),
    };
    await setDashboardAuthCookie(cookieStore, request, claims, config);
    outcome.identity = sessionActor(claims);

    return NextResponse.redirect(new URL("/dashboard", getPublicOrigin(request)));
  } catch (error) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "oidc_callback_failed")}`, getPublicOrigin(request)));
  }
}

export async function GET(request) {
  const outcome = {};
  try { return await callback(request, outcome); }
  finally {
    await audit(request, "login", { identity: outcome.identity ?? { actor: "oidc", actorRole: "anonymous" },
      result: outcome.identity ? "success" : "failure" });
  }
}
