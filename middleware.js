import createMiddleware from "next-intl/middleware";
import { NextResponse } from "next/server";

const intlMiddleware = createMiddleware({
  locales: ["vi", "en"],
  defaultLocale: "vi",
  localePrefix: "never",
  localeDetection: true,
});

export default function middleware(request) {
  const { pathname } = request.nextUrl;
  const match = pathname.match(/^\/(vi|en)(\/|$)/);
  if (match) {
    const locale = match[1];
    const url = request.nextUrl.clone();
    const strippedPathname = pathname.replace(/^\/(vi|en)(?=\/|$)/, "") || "/";
    url.pathname = strippedPathname;
    const response = NextResponse.redirect(url);
    response.cookies.set("NEXT_LOCALE", locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
    return response;
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
