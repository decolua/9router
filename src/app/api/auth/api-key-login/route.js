import { NextResponse } from "next/server";
import { getApiKeyByValue } from "@/lib/localDb";
import { SignJWT } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

export async function POST(request) {
  try {
    const { apiKey } = await request.json();
    const rawKey = String(apiKey || "").trim();

    if (!rawKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 400 });
    }

    const key = await getApiKeyByValue(rawKey);
    if (!key) {
      return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
    }

    const token = await new SignJWT({
      authenticated: true,
      apiKeyId: key.id,
      authType: "apiKey",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(SECRET);

    const cookieStore = await cookies();
    cookieStore.set("auth_token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
