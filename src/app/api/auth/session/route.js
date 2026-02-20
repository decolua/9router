import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

export async function GET(request) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ authenticated: false });
    }
    const { payload } = await jwtVerify(token, SECRET);
    return NextResponse.json({
      authenticated: true,
      authType: payload?.authType || "admin",
      apiKeyId: payload?.apiKeyId || null,
    });
  } catch (error) {
    return NextResponse.json({ authenticated: false });
  }
}
