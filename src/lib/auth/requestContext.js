import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserById, getAdminUser } from "@/lib/db/repos/usersRepo.js";

export const USER_ID_HEADER = "x-ebr-user-id";
export const USER_ROLE_HEADER = "x-ebr-user-role";

export async function getSessionUser(token) {
  const session = await getDashboardAuthSession(token);
  if (!session?.userId) return null;
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active") return null;
  return user;
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

  const token = request.cookies?.get?.("auth_token")?.value;
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
  if (!user) {
    return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user, error: null };
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
