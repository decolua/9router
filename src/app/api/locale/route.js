import { NextResponse } from "next/server";
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";

export async function POST(request) {
  try {
    const payload = await request.json();
    const locale = normalizeLocale(payload?.locale || DEFAULT_LOCALE);

    const response = NextResponse.json({ ok: true, locale });
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid locale payload" },
      { status: 400 },
    );
  }
}
