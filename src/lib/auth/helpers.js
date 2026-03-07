/**
 * Helper to extract user information from request headers set by dashboard guard
 * @param {Request} request - The incoming request
 * @returns {Object|null} User object with id, email, displayName, isAdmin, tenantId
 */
export function getUserFromRequest(request) {
  const userId = request.headers.get("x-user-id");
  
  if (!userId) {
    return null;
  }
  
  const displayNameEncoded = request.headers.get("x-user-display-name");
  const displayName = displayNameEncoded ? decodeURIComponent(displayNameEncoded) : null;
  
  return {
    id: userId,
    email: request.headers.get("x-user-email") || null,
    displayName: displayName,
    isAdmin: request.headers.get("x-user-is-admin") === "true",
    tenantId: request.headers.get("x-user-tenant-id") || null,
  };
}

/**
 * Middleware helper to require authentication in API routes
 * @param {Request} request - The incoming request
 * @returns {Object} User object
 * @throws {Error} If user is not authenticated
 */
export function requireAuth(request) {
  const user = getUserFromRequest(request);
  
  if (!user) {
    throw new Error("Authentication required");
  }
  
  return user;
}

/**
 * Middleware helper to require admin role in API routes
 * @param {Request} request - The incoming request
 * @returns {Object} User object
 * @throws {Error} If user is not authenticated or not an admin
 */
export function requireAdmin(request) {
  const user = requireAuth(request);
  
  if (!user.isAdmin) {
    throw new Error("Admin access required");
  }
  
  return user;
}
