import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";

/**
 * Decode JWT payload without verification (we only need claims).
 */
function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const missingPadding = (4 - (base64.length % 4)) % 4;
    const padded = base64 + "=".repeat(missingPadding);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * Extract account info from ChatGPT session accessToken JWT.
 * The JWT contains claims like:
 *   - https://api.openai.com/auth → { chatgpt_account_id, chatgpt_plan_type }
 *   - email, sub, exp, etc.
 */
function extractSessionInfo(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  if (!payload) return null;

  const authClaim = payload["https://api.openai.com/auth"] || {};
  return {
    email: payload.email || payload.preferred_username || null,
    sub: payload.sub || null,
    chatgptAccountId: authClaim.chatgpt_account_id || null,
    chatgptPlanType: authClaim.chatgpt_plan_type || null,
    exp: payload.exp || null,
  };
}

/**
 * POST /api/oauth/codex/import-session
 * Import Codex account from ChatGPT session JSON.
 *
 * Request body supports:
 * - Single session object: { accessToken, user?, expires? }
 * - Array of sessions: [{ accessToken, ... }, ...]
 * - Direct accessToken string: { accessToken: "eyJ..." }
 */
export async function POST(request) {
  try {
    const body = await request.json();

    // Normalize input: support single object, array, or direct token
    let sessions = [];
    if (Array.isArray(body)) {
      sessions = body;
    } else if (body.sessions && Array.isArray(body.sessions)) {
      sessions = body.sessions;
    } else {
      sessions = [body];
    }

    if (sessions.length === 0) {
      return NextResponse.json({ error: "No sessions provided" }, { status: 400 });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const accessToken = session.accessToken || session.access_token;

      if (!accessToken || typeof accessToken !== "string") {
        errors.push({ index: i, error: "Missing accessToken" });
        continue;
      }

      // Extract info from JWT
      const info = extractSessionInfo(accessToken);
      const email = info?.email || session.user?.email || null;
      const displayName = session.user?.name || null;

      // Calculate expiry from JWT exp claim or session.expires
      let expiresAt = null;
      if (info?.exp) {
        expiresAt = new Date(info.exp * 1000).toISOString();
      } else if (session.expires) {
        expiresAt = new Date(session.expires).toISOString();
      }

      try {
        // Create provider connection — uses upsert by email for OAuth type
        const connection = await createProviderConnection({
          provider: "codex",
          authType: "oauth",
          accessToken,
          refreshToken: null, // Session token has no refresh token
          expiresAt,
          email,
          displayName,
          providerSpecificData: {
            chatgptAccountId: info?.chatgptAccountId || null,
            chatgptPlanType: info?.chatgptPlanType || null,
            importMethod: "session",
          },
          testStatus: "active",
        });

        results.push({
          index: i,
          connectionId: connection.id,
          email: connection.email || email,
          plan: info?.chatgptPlanType || null,
        });
      } catch (err) {
        errors.push({ index: i, email, error: err.message });
      }
    }

    return NextResponse.json({
      success: results.length > 0,
      imported: results.length,
      failed: errors.length,
      connections: results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.log("Codex import-session error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
