import { NextResponse } from "next/server";
import {
  getSettings,
  getOrCreateUserByEmail,
  getUserByEmail,
} from "@/lib/localDb";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "egs-proxy-ai-default-secret-change-me"
);

function setAuthCookie(request, token) {
  const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isHttpsRequest = forwardedProto === "https";
  const useSecureCookie = forceSecureCookie || isHttpsRequest;
  return {
    httpOnly: true,
    secure: useSecureCookie,
    sameSite: "lax",
    path: "/",
  };
}

async function issueSession(request, user) {
  const token = await new SignJWT({
    userId: user.id,
    email: user.email,
    displayName: user.displayName ?? undefined,
    isAdmin: user.isAdmin,
    status: user.status ?? "active",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("24h")
    .sign(SECRET);

  const cookieStore = await cookies();
  cookieStore.set("auth_token", token, setAuthCookie(request, token));
  return NextResponse.json({ success: true });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    // Email + password login (per-user account)
    if (email != null && email !== "") {
      const trimmedEmail = String(email).trim().toLowerCase();
      const user = await getUserByEmail(trimmedEmail);
      if (!user) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }
      if (!user.passwordHash) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: "Invalid email or password" },
          { status: 401 }
        );
      }
      const status = user.status ?? "active";
      if (status !== "active") {
        return NextResponse.json(
          {
            error: "Account pending approval",
            code: "PENDING_APPROVAL",
          },
          { status: 403 }
        );
      }
      return issueSession(request, user);
    }

    // Legacy: single shared password (no email)
    const settings = await getSettings();
    const storedHash = settings.password;
    let isValid = false;
    if (storedHash) {
      isValid = await bcrypt.compare(password, storedHash);
    } else {
      const initialPassword = process.env.INITIAL_PASSWORD || "123456";
      isValid = password === initialPassword;
    }

    if (isValid) {
      const defaultEmail =
        process.env.DEFAULT_USER_EMAIL || "admin@egsproxy.local";
      const user = await getOrCreateUserByEmail(defaultEmail);
      const status = user.status ?? "active";
      if (status !== "active") {
        return NextResponse.json(
          {
            error: "Account pending approval",
            code: "PENDING_APPROVAL",
          },
          { status: 403 }
        );
      }
      return issueSession(request, user);
    }

    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
