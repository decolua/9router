import { cookies } from "next/headers";
import { jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

/**
 * Get current user ID from request (dashboard or API with session).
 * 1. Tries x-user-id header (set by dashboardGuard middleware).
 * 2. Falls back to auth_token cookie (for same-origin requests e.g. OAuth exchange).
 * @param {Request} request - Next.js request
 * @returns {Promise<string|null>} userId or null if not authenticated
 */
export async function getUserIdFromRequest(request) {
  const headerUserId = request.headers.get("x-user-id");
  if (headerUserId) return headerUserId;

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, SECRET);
    return payload.userId ?? null;
  } catch {
    return null;
  }
}
