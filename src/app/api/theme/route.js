import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSettings, updateSettings } from "@/lib/localDb";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

// The site-wide mode. Reading is public on purpose: ThemeProvider applies it to
// every visitor before they sign in, and it is one non-sensitive value.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { theme: "glass" },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// Writing is the administrator's: a key-signed session is refused here even if
// it somehow reached this route, because the mode is a site-wide setting rather
// than a per-browser preference.
export async function POST(request) {
  try {
    const cookieStore = await cookies();
    const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
    if (!session) {
      return NextResponse.json({ error: "Sign in to change the theme" }, { status: 401 });
    }
    if (session.role === "apikey") {
      return NextResponse.json(
        { error: "The theme applies to the whole site and can only be changed from a password sign-in" },
        { status: 403 }
      );
    }

    // Theme is locked strictly to glass site-wide
    await updateSettings({ theme: "glass" });
    return NextResponse.json({ theme: "glass", ok: true });
  } catch (error) {
    console.log("Error setting theme:", error);
    return NextResponse.json({ error: "Failed to set theme" }, { status: 500 });
  }
}
