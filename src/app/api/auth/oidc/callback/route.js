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
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { getUserByOidcSub, getUserByEmail, createUser } from "@/lib/db/repos/usersRepo.js";
import { getOrganizationById } from "@/lib/db/repos/organizationsRepo.js";
import { requireOrgFromRequest, runWithRequestOrg } from "@/lib/org/orgContext.js";

function clearOidcCookies(cookieStore) {
  cookieStore.delete("oidc_state");
  cookieStore.delete("oidc_nonce");
  cookieStore.delete("oidc_code_verifier");
}

export async function GET(request) {
  return runWithRequestOrg(request, async () => {
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
    const { org, error: orgError } = await requireOrgFromRequest(request);
    if (orgError) {
      clearOidcCookies(cookieStore);
      return NextResponse.redirect(new URL("/login?error=org_not_found", getPublicOrigin(request)));
    }

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

    const oidcSub = payload.sub || null;
    const oidcEmail = pickOidcEmail(payload) || null;
    const oidcName = pickOidcDisplayName(payload);

    let user = await getUserByOidcSub(oidcSub, org.id);
    if (!user && oidcEmail) {
      user = await getUserByEmail(oidcEmail, org.id);
      if (user) {
        const { updateUser } = await import("@/lib/db/repos/usersRepo.js");
        user = await updateUser(user.id, { oidcSub });
      }
    }
    if (!user) {
      user = await createUser({
        orgId: org.id,
        email: oidcEmail || `${oidcSub}@oidc.local`,
        name: oidcName || oidcEmail || "OIDC User",
        role: "member",
        oidcSub,
      });
    }
    if (user.status !== "active") {
      throw new Error("Account is disabled");
    }

    const orgRecord = await getOrganizationById(org.id);
    clearOidcCookies(cookieStore);
    await setDashboardAuthCookie(cookieStore, request, {
      userId: user.id,
      orgId: user.orgId,
      orgSlug: orgRecord?.slug,
      role: user.role,
      email: user.email,
      name: user.name,
      oidc: true,
      oidcSub,
      oidcEmail,
      oidcName,
    });

    return NextResponse.redirect(new URL("/dashboard", getPublicOrigin(request)));
  } catch (error) {
    clearOidcCookies(cookieStore);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "oidc_callback_failed")}`, getPublicOrigin(request)));
  }
  });
}
