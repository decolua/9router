import { NextResponse } from "next/server";

const SUPPORTED_LOCALES = new Set(["vi", "en"]);

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const requestedLocale = searchParams.get("locale");
  const locale = SUPPORTED_LOCALES.has(requestedLocale) ? requestedLocale : "vi";
  const redirectParam = searchParams.get("redirect") || "/";
  const safeRedirect = redirectParam.startsWith("/") && !redirectParam.startsWith("//")
    ? redirectParam.replace(/^\/(vi|en)(?=\/|$)/, "") || "/"
    : "/";

  const response = NextResponse.redirect(new URL(safeRedirect, request.url));
  response.cookies.set("NEXT_LOCALE", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return response;
}
