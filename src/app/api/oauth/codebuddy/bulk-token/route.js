import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";

export const dynamic = "force-dynamic";

const CODEBUDDY_PROVIDER_ID = "codebuddy";
const CODEBUDDY_DOMAIN = "www.codebuddy.ai";

async function fetchAccountInfo(accessToken, domain) {
  try {
    const response = await fetch(`https://${domain}/v2/plugin/accounts`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-Domain": domain,
      },
    });

    if (!response.ok) return { uid: null, email: null, nickname: null };

    const body = await response.json();
    const accounts = body?.data?.accounts || [];
    const account = accounts.find((a) => a.lastLogin) || accounts[0] || {};
    return {
      uid: account.uid || null,
      email: account.email || account.nickname || null,
      nickname: account.nickname || null,
      enterpriseId: account.enterpriseId || null,
    };
  } catch {
    return { uid: null, email: null, nickname: null };
  }
}

/**
 * Parse a token line into its components.
 *
 * Supported formats:
 * - accessToken (single JWT token)
 * - accessToken:refreshToken (two JWT tokens)
 * - accessToken:refreshToken:apiKey (two JWT tokens + API key)
 *
 * JWT tokens contain dots (e.g., eyJhbGciOiJSUzI1NiIs...) but NOT colons,
 * so splitting on ":" is safe.
 *
 * @param {string} line - The token line to parse
 * @returns {{ accessToken: string, refreshToken?: string, apiKey?: string, format: string }}
 */
function parseTokenLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  // Split on colon to detect format
  const parts = trimmed.split(":");

  // Validate that the first part looks like a JWT (contains dots)
  if (!parts[0] || !parts[0].includes(".")) {
    throw new Error("Invalid access token format - not a valid JWT");
  }

  if (parts.length === 1) {
    // Format: accessToken only
    return {
      accessToken: parts[0],
      format: "access-only",
    };
  } else if (parts.length === 2) {
    // Format: accessToken:refreshToken
    if (!parts[1] || !parts[1].includes(".")) {
      throw new Error("Invalid refresh token format - not a valid JWT");
    }
    return {
      accessToken: parts[0],
      refreshToken: parts[1],
      format: "with-refresh",
    };
  } else if (parts.length === 3) {
    // Format: accessToken:refreshToken:apiKey
    if (!parts[1] || !parts[1].includes(".")) {
      throw new Error("Invalid refresh token format - not a valid JWT");
    }
    if (!parts[2]) {
      throw new Error("API key is empty");
    }
    return {
      accessToken: parts[0],
      refreshToken: parts[1],
      apiKey: parts[2],
      format: "with-api-key",
    };
  } else {
    // More than 3 parts - likely malformed
    throw new Error("Invalid token format - too many colons detected");
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const rawTokens = body?.tokens;

    if (!rawTokens || (typeof rawTokens !== "string" && !Array.isArray(rawTokens))) {
      return NextResponse.json(
        { error: "Provide tokens as a string (one per line) or array" },
        { status: 400 }
      );
    }

    const tokenList = Array.isArray(rawTokens)
      ? rawTokens.map((t) => String(t || "").trim()).filter(Boolean)
      : String(rawTokens)
          .split(/[\r\n]+/)
          .map((t) => t.trim())
          .filter(Boolean);

    if (tokenList.length === 0) {
      return NextResponse.json(
        { error: "At least one token is required" },
        { status: 400 }
      );
    }

    const results = [];
    const formatCounts = {
      "access-only": 0,
      "with-refresh": 0,
      "with-api-key": 0,
    };

    for (const tokenLine of tokenList) {
      try {
        // Parse the token line to extract components
        const parsed = parseTokenLine(tokenLine);
        if (!parsed) {
          results.push({
            token: "(empty line)",
            status: "failed",
            error: "Empty or invalid token line",
          });
          continue;
        }

        const { accessToken, refreshToken, apiKey, format } = parsed;
        formatCounts[format]++;

        // Validate access token by calling the API
        const info = await fetchAccountInfo(accessToken, CODEBUDDY_DOMAIN);
        const email = info.email || `token-${accessToken.substring(0, 8)}...`;

        // Build providerSpecificData based on format
        const providerSpecificData = {
          domain: CODEBUDDY_DOMAIN,
          loginEmail: email,
          automation: "bulk-token-import",
          authMode: apiKey ? "generated-api-key" : "oauth-only",
        };

        if (info.uid) providerSpecificData.uid = info.uid;
        if (info.enterpriseId) providerSpecificData.enterpriseId = info.enterpriseId;

        // If API key is provided, store it in providerSpecificData as well
        if (apiKey) {
          providerSpecificData.codebuddyApiKeyId = apiKey;
        }

        // Determine expiry: API keys last 365 days, OAuth tokens 24 hours
        const expiresIn = apiKey ? 31536000 : 86400; // 365 days vs 24 hours

        // Build connection data
        const connectionData = {
          provider: CODEBUDDY_PROVIDER_ID,
          authType: "oauth",
          accessToken: accessToken,
          email,
          providerSpecificData,
          expiresIn,
          testStatus: info.uid || apiKey ? "active" : "unknown",
        };

        // Add refreshToken if provided
        if (refreshToken) {
          connectionData.refreshToken = refreshToken;
        }

        // Add apiKey if provided
        if (apiKey) {
          connectionData.apiKey = apiKey;
        }

        const connection = await createProviderConnection(connectionData);

        results.push({
          email,
          status: "success",
          connectionId: connection.id,
          uid: info.uid,
          format,
          hasRefreshToken: !!refreshToken,
          hasApiKey: !!apiKey,
        });
      } catch (error) {
        results.push({
          token: tokenLine.substring(0, 12) + "...",
          status: "failed",
          error: error.message || "Failed to import token",
        });
      }
    }

    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    return NextResponse.json({
      success: true,
      imported: successCount,
      failed: failedCount,
      total: tokenList.length,
      formatCounts,
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Failed to import tokens" },
      { status: 500 }
    );
  }
}
