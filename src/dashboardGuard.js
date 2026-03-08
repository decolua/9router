import { NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "egs-proxy-ai-default-secret-change-me"
);

function applyAuthHeaders(request, payload) {
  const requestHeaders = new Headers(request.headers);
  if (payload.userId) requestHeaders.set("x-user-id", payload.userId);
  if (payload.email) requestHeaders.set("x-user-email", payload.email);
  if (payload.displayName) requestHeaders.set("x-user-display-name", encodeURIComponent(payload.displayName));
  if (payload.isAdmin !== undefined) requestHeaders.set("x-user-is-admin", payload.isAdmin.toString());
  if (payload.tenantId) requestHeaders.set("x-user-tenant-id", payload.tenantId);
  return requestHeaders;
}

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // API routes: set auth headers from cookie so handlers (usage, keys, combos, admin, etc.) get user
  if (pathname.startsWith("/api/")) {
    const token = request.cookies.get("auth_token")?.value;
    const isAdminRoute = pathname.startsWith("/api/admin/");
    const isAuthMe = pathname === "/api/auth/me";

    if (token) {
      try {
        const { payload } = await jwtVerify(token, SECRET);
        const status = payload.status ?? "active";
        if (status !== "active") {
          return NextResponse.json(
            { error: "Account pending approval", code: "PENDING_APPROVAL" },
            { status: 403 }
          );
        }
        if (isAdminRoute && !payload.isAdmin) {
          return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }
        const requestHeaders = applyAuthHeaders(request, payload);
        return NextResponse.next({ request: { headers: requestHeaders } });
      } catch {
        if (isAdminRoute || isAuthMe) {
          return NextResponse.json({ error: "Authentication required" }, { status: 401 });
        }
        // Invalid token for other API routes: continue without headers (route may return 401)
      }
    } else {
      if (isAdminRoute || isAuthMe) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
    }
    return NextResponse.next();
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    const token = request.cookies.get("auth_token")?.value;

    if (token) {
      try {
        const { payload } = await jwtVerify(token, SECRET);
        const status = payload.status ?? "active";
        if (status !== "active") {
          return NextResponse.redirect(
            new URL(
              "/login?error=" + encodeURIComponent("Account pending approval"),
              request.url
            )
          );
        }
        // Check admin-only routes
        if (pathname.startsWith("/dashboard/admin") && !payload.isAdmin) {
          return NextResponse.redirect(new URL("/dashboard", request.url));
        }
        const requestHeaders = applyAuthHeaders(request, payload);
        return NextResponse.next({
          request: { headers: requestHeaders },
        });
      } catch (err) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    const origin = request.nextUrl.origin;
    try {
      const res = await fetch(`${origin}/api/settings/require-login`);
      const data = await res.json();
      if (data.requireLogin === false) {
        return NextResponse.next();
      }
    } catch (err) {
      // On error, require login
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
