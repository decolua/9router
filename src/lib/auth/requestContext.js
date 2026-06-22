import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserById, getUserByEmail, getAdminUser } from "@/lib/db/repos/usersRepo.js";

export const USER_ID_HEADER = "x-ebr-user-id";
export const USER_ROLE_HEADER = "x-ebr-user-role";

function stripPasswordHash(user) {
  if (!user) return null;
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export async function getSessionUser(token) {
  const session = await getDashboardAuthSession(token);
  if (!session) return null;

  if (session.userId) {
    const user = await getUserById(session.userId);
    if (user?.status === "active") return user;
    if (!user) {
      const admin = await getAdminUser();
      if (admin?.status === "active") return stripPasswordHash(admin);
    }
    return null;
  }

  // Legacy JWTs may only carry `authenticated` without userId.
  if (session.authenticated) {
    const admin = await getAdminUser();
    if (admin?.status === "active") return stripPasswordHash(admin);
  }

  const email = String(session.email || session.oidcEmail || "").trim();
  if (email) {
    const user = await getUserByEmail(email);
    if (user?.status === "active") return stripPasswordHash(user);
  }

  return null;
}

export async function getRequestUser(request) {
  const headerId = request.headers.get(USER_ID_HEADER);
  const headerRole = request.headers.get(USER_ROLE_HEADER);
  if (headerId) {
    const user = await getUserById(headerId);
    if (user && user.status === "active") {
      if (headerRole && user.role !== headerRole) return null;
      return user;
    }
  }

  let token = request.cookies?.get?.("auth_token")?.value;
  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get("auth_token")?.value;
    } catch {
      // ignore — cookies() unavailable outside request scope
    }
  }
  if (token) return await getSessionUser(token);

  return null;
}

export async function getRequestUserFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  return await getSessionUser(token);
}

export async function requireRequestUser(request) {
  const user = await getRequestUser(request);
  if (user) return { user, error: null };

  const admin = await getAdminUser();
  if (admin?.status === "active") {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    if (settings?.requireLogin === false) return { user: admin, error: null };

    let token = request.cookies?.get?.("auth_token")?.value;
    if (!token) {
      try {
        const cookieStore = await cookies();
        token = cookieStore.get("auth_token")?.value;
      } catch {
        // ignore
      }
    }
    if (token) {
      const session = await getDashboardAuthSession(token);
      if (session?.userId && !(await getUserById(session.userId))) {
        return { user: admin, error: null };
      }
      if (session?.authenticated && !session?.userId) {
        return { user: admin, error: null };
      }
    }
  }

  return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
}

export async function requireAdminUser(request) {
  const { user, error } = await requireRequestUser(request);
  if (error) return { user: null, error };
  if (user.role !== "admin") {
    return { user: null, error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { user, error: null };
}

/** CLI token acts as the primary admin for local tooling. */
export async function getCliContextUser() {
  return await getAdminUser();
}

export function attachUserHeaders(request, user) {
  const headers = new Headers(request.headers);
  headers.set(USER_ID_HEADER, user.id);
  headers.set(USER_ROLE_HEADER, user.role);
  return headers;
}
