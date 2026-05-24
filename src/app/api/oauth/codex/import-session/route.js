import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";

/**
 * Validate that an access token actually works against ChatGPT backend.
 * Without this, import-session would happily save invalid/expired tokens
 * with testStatus="active" and the user only finds out when chat fails.
 *
 * We use the Codex responses endpoint (POST) because /backend-api/me is
 * blocked by Cloudflare from server IPs. The responses endpoint with an
 * empty body returns 401 for invalid tokens and 400 for valid tokens
 * (auth passed but request body invalid).
 *
 * Returns { valid, status, error? }.
 */
async function validateSessionToken(accessToken) {
  try {
    const res = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "codex-cli/1.0.18 (macOS; arm64)",
        "Originator": "codex-cli",
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(15_000),
    });
    // 401 = token invalid/expired/revoked
    if (res.status === 401) {
      const body = await res.text().catch(() => "");
      return { valid: false, status: 401, error: body.slice(0, 200) };
    }
    // 403 = Cloudflare/geo block (can't validate, allow through)
    if (res.status === 403) {
      return { valid: true, status: 403, error: "Cannot validate (blocked); allowing import" };
    }
    // Any other status (400, 200, 429, etc.) means auth passed
    return { valid: true, status: res.status };
  } catch (err) {
    // Network error — allow import (don't block on transient failures)
    return { valid: true, status: 0, error: `Network: ${err?.message || err}` };
  }
}

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

      // Reject tokens whose JWT has already expired before doing any
      // network calls — cheap fast path.
      if (info?.exp && info.exp * 1000 <= Date.now()) {
        errors.push({
          index: i,
          email,
          error: "Token JWT already expired (exp in past); paste a fresh session",
        });
        continue;
      }

      // Network validation: hit /backend-api/me with the bearer token.
      // Without this, invalid tokens get saved as testStatus=active and the
      // user only finds out when chat requests start failing.
      const validation = await validateSessionToken(accessToken);
      if (!validation.valid) {
        errors.push({
          index: i,
          email,
          error: `Token validation failed: HTTP ${validation.status}${
            validation.error ? " \u2014 " + validation.error : ""
          }`,
        });
        continue;
      }

      // Prefer plan/account from the live /me response over JWT claims (more
      // accurate for upgraded accounts).
      const planType = validation.planType || info?.chatgptPlanType || null;
      const accountId = validation.accountId || info?.chatgptAccountId || null;

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
            chatgptAccountId: accountId,
            chatgptPlanType: planType,
            importMethod: "session",
          },
          testStatus: "active",
        });

        results.push({
          index: i,
          connectionId: connection.id,
          email: connection.email || email,
          plan: planType,
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
