import { NextResponse } from "next/server";
import { createUserWithPassword, getUserByEmail } from "@/lib/localDb";
import { notifyAdminsNewPendingRegistration } from "@/lib/email";
import bcrypt from "bcryptjs";

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request) {
  try {
    const body = await request.json();
    const { email, password, displayName } = body;

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }
    const trimmedEmail = email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string") {
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 }
      );
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
        { status: 400 }
      );
    }

    const existing = await getUserByEmail(trimmedEmail);
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);
    const user = await createUserWithPassword(
      trimmedEmail,
      passwordHash,
      displayName?.trim() || null
    );

    if (!user) {
      return NextResponse.json(
        { error: "Registration failed" },
        { status: 500 }
      );
    }

    if (user.status === "pending") {
      notifyAdminsNewPendingRegistration({
        email: user.email,
        displayName: user.displayName,
      }).catch((err) => console.error("[auth/register] Admin notify failed:", err));
    }

    return NextResponse.json({
      success: true,
      message:
        user.status === "active"
          ? "Account created. You can sign in now."
          : "Account created. Your account is pending approval. You will be able to sign in once an administrator activates it.",
      status: user.status,
    });
  } catch (error) {
    console.error("[auth/register]", error);
    return NextResponse.json(
      { error: error.message || "Registration failed" },
      { status: 500 }
    );
  }
}
