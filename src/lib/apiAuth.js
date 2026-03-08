import { jwtVerify } from "jose";
import { getApiKeys } from "@/lib/localDb.js";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

/**
 * Authentication middleware for API routes
 * Supports both JWT cookie (for dashboard users) and Bearer API key
 * 
 * @param {Request} request - Next.js request object
 * @returns {Promise<{authenticated: boolean, user?: object, apiKey?: string, error?: string}>}
 */
export async function requireAuth(request) {
  // Try JWT cookie first (dashboard users)
  const token = request.cookies.get("auth_token")?.value;
  
  if (token) {
    try {
      const { payload } = await jwtVerify(token, SECRET);
      return { authenticated: true, user: payload };
    } catch (err) {
      // JWT invalid, continue to try API key
    }
  }

  // Try Bearer API key
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const apiKey = authHeader.substring(7);
    
    try {
      const apiKeys = await getApiKeys();
      const validKey = apiKeys.find(k => k.key === apiKey);
      
      if (validKey) {
        return { authenticated: true, apiKey: validKey.key, keyName: validKey.name };
      }
    } catch (err) {
      console.error("[apiAuth] Error validating API key:", err);
    }
  }

  return { authenticated: false, error: "Authentication required" };
}

/**
 * Helper to return 401 Unauthorized response
 */
export function unauthorizedResponse(message = "Authentication required") {
  return new Response(
    JSON.stringify({ error: message }),
    { 
      status: 401,
      headers: { "Content-Type": "application/json" }
    }
  );
}
