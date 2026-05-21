import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  buildCasServiceUrl,
  getCasRuntimeConfig,
  validateCasTicket,
} from "@/lib/auth/cas";
import { getPublicOrigin } from "@/lib/auth/oidc";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";

function clearCasCookies(cookieStore) {
  cookieStore.delete("cas_state");
}

export async function GET(request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket");
  const state = url.searchParams.get("state");

  if (!ticket || !state) {
    return NextResponse.redirect(new URL("/login?error=cas_missing_ticket", getPublicOrigin(request)));
  }

  const cookieStore = await cookies();
  const storedState = cookieStore.get("cas_state")?.value;
  if (!storedState || storedState !== state) {
    clearCasCookies(cookieStore);
    return NextResponse.redirect(new URL("/login?error=cas_invalid_state", getPublicOrigin(request)));
  }

  try {
    const config = await getCasRuntimeConfig();
    if (!config) {
      clearCasCookies(cookieStore);
      return NextResponse.redirect(new URL("/login?error=cas_not_configured", getPublicOrigin(request)));
    }

    const serviceUrl = buildCasServiceUrl(request, state);
    const casUser = await validateCasTicket({
      serverUrl: config.serverUrl,
      validatePath: config.validatePath,
      serviceUrl,
      ticket,
    });

    clearCasCookies(cookieStore);
    await setDashboardAuthCookie(cookieStore, request, {
      cas: true,
      casUser: casUser.user,
      casEmail: casUser.email || null,
      casName: casUser.displayName,
    });

    return NextResponse.redirect(new URL("/dashboard", getPublicOrigin(request)));
  } catch (error) {
    clearCasCookies(cookieStore);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message || "cas_callback_failed")}`, getPublicOrigin(request)));
  }
}

