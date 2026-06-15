import { NextResponse } from "next/server";
import { getSettings, countUsers, consumeInvite, createUser } from "@/lib/localDb";
import { cookies } from "next/headers";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
import { validatePassword } from "@/lib/auth/passwordPolicy";
import { auditFromRequest, AuditAction } from "@/lib/audit";

export async function POST(request) {
  try {
    const settings = await getSettings();
    const body = await request.json();
    const { inviteToken, email, name, password } = body;

    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const userCount = await countUsers();
    let user;

    if (userCount === 0) {
      user = await createUser({
        email: normalizedEmail,
        name: name || normalizedEmail.split("@")[0],
        password,
        role: "admin",
      });
    } else if (inviteToken) {
      user = await consumeInvite(inviteToken, {
        email: normalizedEmail,
        name: name || normalizedEmail.split("@")[0],
        password,
      });
    } else if (settings.signupMode === "open") {
      user = await createUser({
        email: normalizedEmail,
        name: name || normalizedEmail.split("@")[0],
        password,
        role: "member",
      });
    } else {
      return NextResponse.json({ error: "An invite token is required to create an account" }, { status: 403 });
    }

    const cookieStore = await cookies();
    await setDashboardAuthCookie(cookieStore, request, {
      userId: user.id,
      role: user.role,
      email: user.email,
      name: user.name,
    });

    await auditFromRequest(request, {
      action: AuditAction.USER_CREATED,
      actorUserId: user.id,
      actorEmail: user.email,
      targetType: "user",
      targetId: user.id,
      meta: { role: user.role, bootstrap: userCount === 0 },
    });

    return NextResponse.json({ success: true, user }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Signup failed" }, { status: 400 });
  }
}
