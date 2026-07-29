import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { getUserById, getUserByEmail, getAdminUser } from "@/lib/db/repos/usersRepo.js";
import { resolveOrgFromRequest, userBelongsToOrg } from "@/lib/org/orgContext.js";
import { isSaas } from "@/lib/deploy/deployMode.js";

export const USER_ID_HEADER = "x-ebr-user-id";
export const USER_ROLE_HEADER = "x-ebr-user-role";
export const ORG_ID_HEADER = "x-ebr-org-id";

function stripPasswordHash(user) {
  if (!user) return null;
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

export async function getSessionUser(token, { orgId } = {}) {
  const session = await getDashboardAuthSession(token);
  if (!session) return null;

  if (session.userId) {
    const user = await getUserById(session.userId);
    if (user?.status === "active") {
      if (orgId && user.orgId !== orgId) return null;
      return user;
    }
    if (!user) {
      const admin = await getAdminUser(orgId);
      if (admin?.status === "active") return stripPasswordHash(admin);
    }
    return null;
  }

  if (session.authenticated) {
    const admin = await getAdminUser(orgId);
    if (admin?.status === "active") return stripPasswordHash(admin);
  }

  const email = String(session.email || session.oidcEmail || "").trim();
  if (email) {
    const user = await getUserByEmail(email, orgId);
    if (user?.status === "active") return stripPasswordHash(user);
  }

  return null;
}

export async function getRequestUser(request) {
  const org = await resolveOrgFromRequest(request);

  const headerId = request.headers.get(USER_ID_HEADER);
  const headerRole = request.headers.get(USER_ROLE_HEADER);
  if (headerId) {
    const user = await getUserById(headerId);
    if (user && user.status === "active") {
      if (org && !userBelongsToOrg(user, org)) return null;
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
  if (token) {
    const user = await getSessionUser(token, { orgId: org?.id });
    if (user && org && !userBelongsToOrg(user, org)) return null;
    if (user && isSaas() && sessionOrgMismatch(token, org)) return null;
    return user;
  }

  return null;
}

async function sessionOrgMismatch(token, org) {
  if (!org) return false;
  const session = await getDashboardAuthSession(token);
  if (session?.orgId && session.orgId !== org.id) return true;
  return false;
}

export async function getRequestUserFromCookies() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;
  return await getSessionUser(token);
}

export async function requireRequestUser(request) {
  const org = await resolveOrgFromRequest(request);
  const user = await getRequestUser(request);
  if (user) return { user, org, error: null };

  const admin = await getAdminUser(org?.id);
  if (admin?.status === "active") {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings(org?.id);
    if (settings?.requireLogin === false) return { user: admin, org, error: null };

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
        return { user: admin, org, error: null };
      }
      if (session?.authenticated && !session?.userId) {
        return { user: admin, org, error: null };
      }
    }
  }

  return { user: null, org, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
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
  if (user.orgId) headers.set(ORG_ID_HEADER, user.orgId);
  return headers;
}
