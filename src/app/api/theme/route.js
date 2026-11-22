import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { updateSettings } from "@/lib/localDb";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";

// The site-wide visual system is locked to neobrutalism. Reading is public on
// purpose: it is a non-sensitive preference shared across the application.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    { theme: "neobrutalism" },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// Writing is the administrator's: a key-signed session is refused here even if
// it somehow reached this route, because the visual system is site-wide rather
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

    // Neobrutalism is the single locked site-wide design system.
    await updateSettings({ theme: "neobrutalism" });
    return NextResponse.json({ theme: "neobrutalism", ok: true });
  } catch (error) {
    console.log("Error setting theme:", error);
    return NextResponse.json({ error: "Failed to set theme" }, { status: 500 });
  }
}
