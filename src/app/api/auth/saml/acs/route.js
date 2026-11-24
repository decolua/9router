import { audit, sessionActor } from "@/lib/observability/audit";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings } from "@/lib/localDb";
import {
  getSamlBaseUrl,
  isSamlConfigured,
  pickSamlDisplayName,
  pickSamlEmail,
  samlRoleAttributes,
  validateSamlResponse,
} from "@/lib/auth/saml.js";
import { ssoRole } from "@/lib/auth/dashboardRoles";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { checkLock, recordFail, recordSuccess, getClientIp } from "@/lib/auth/loginLimiter";

async function callback(request, outcome) {
  const settings = await getSettings();
  const origin = getSamlBaseUrl(request, settings);
  const ip = getClientIp(request);

  const lock = checkLock(ip);
  if (lock.locked) {
    return NextResponse.redirect(
      new URL(
        `/login?error=${encodeURIComponent(`Too many failed attempts. Try again in ${lock.retryAfter}s.`)}`,
        origin
      )
    );
  }

  const cookieStore = await cookies();
  const storedRequestId = cookieStore.get("saml_state")?.value || "";

  // Always clear saml_state cookie after attempt
  cookieStore.delete("saml_state");

  try {
    const formData = await request.formData();
    const SAMLResponse = formData.get("SAMLResponse");

    if (!SAMLResponse) {
      recordFail(ip);
      return NextResponse.redirect(new URL("/login?error=saml_missing_response", origin));
    }

    if (!isSamlConfigured(settings)) {
      recordFail(ip);
      return NextResponse.redirect(new URL("/login?error=saml_not_configured", origin));
    }

    const profile = await validateSamlResponse(request, { SAMLResponse }, storedRequestId, settings);

    const samlEmail = pickSamlEmail(profile, settings) || null;
    const samlName = pickSamlDisplayName(profile, settings) || "SAML user";

    recordSuccess(ip);

    const { email, groups } = samlRoleAttributes(profile, settings);
    const claims = {
      role: ssoRole(settings, email, groups),
      saml: true,
      samlEmail,
      samlName,
    };
    await setDashboardAuthCookie(cookieStore, request, claims, settings);
    outcome.identity = sessionActor(claims);

    return NextResponse.redirect(new URL("/dashboard", origin));
  } catch (error) {
    recordFail(ip);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message || "saml_acs_failed")}`, origin)
    );
  }
}

export async function POST(request) {
  const outcome = {};
  try { return await callback(request, outcome); }
  finally {
    await audit(request, "login", { identity: outcome.identity ?? { actor: "saml", actorRole: "anonymous" },
      result: outcome.identity ? "success" : "failure" });
  }
}
