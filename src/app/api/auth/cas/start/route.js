import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  buildCasLoginUrl,
  buildCasServiceUrl,
  createCasState,
  getCasRuntimeConfig,
} from "@/lib/auth/cas";
import { getPublicOrigin } from "@/lib/auth/oidc";
import { shouldUseSecureCookie } from "@/lib/auth/dashboardSession";

export async function GET(request) {
  try {
    const config = await getCasRuntimeConfig();
    if (!config) {
      return NextResponse.redirect(new URL("/login?error=cas_not_configured", getPublicOrigin(request)));
    }

    const state = createCasState();
    const serviceUrl = buildCasServiceUrl(request, state);
    const loginUrl = buildCasLoginUrl({
      serverUrl: config.serverUrl,
      serviceUrl,
    });

    const cookieStore = await cookies();
    cookieStore.set("cas_state", state, {
      httpOnly: true,
      secure: shouldUseSecureCookie(request),
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60,
    });

    return NextResponse.redirect(loginUrl);
  } catch (error) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "cas_start_failed")}`, getPublicOrigin(request)));
  }
}

