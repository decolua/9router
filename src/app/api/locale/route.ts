import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { LOCALE_COOKIE, normalizeLocale, isSupportedLocale } from "@/i18n/config";

export async function POST(request: NextRequest) {
  try {
    const parsed: JsonValue = await request.json();
    const locale =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed["locale"] === "string"
        ? parsed["locale"]
        : null;

    if (!locale || !isSupportedLocale(locale)) {
      return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
    }

    const normalized = normalizeLocale(locale);
    const cookieStore = await cookies();
    cookieStore.set(LOCALE_COOKIE, normalized, {
      path: "/",
      maxAge: 60 * 60 * 24 * 365, // 1 year
    });

    return NextResponse.json({ success: true, locale: normalized });
  } catch {
    return NextResponse.json({ error: "Failed to set locale" }, { status: 500 });
  }
}
