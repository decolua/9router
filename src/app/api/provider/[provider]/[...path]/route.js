import { NextResponse } from "next/server";
import { getSettings, getApiKeys } from "@/lib/localDb";

/**
 * Amp CLI Provider API Proxy
 * Route: /api/provider/{provider}/v1/...
 *
 * Logic:
 * 1. Check if model is configured locally in ampModelMappings
 * 2. If YES: Route to local 9router providers (preserve API shape)
 * 3. If NO: Forward to ampcode.com as reverse proxy
 */

function extractApiKeyFromRequest(request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader) return authHeader.replace(/^Bearer\s+/i, "");
  return request.headers.get("x-api-key") || "";
}

function resolveMappedModel(ampModelMappings, requestedModel) {
  if (!requestedModel || !ampModelMappings) return null;

  // Direct mapping (new style where key is exact Amp model id)
  if (ampModelMappings[requestedModel]) return ampModelMappings[requestedModel];

  // Backward compatibility: legacy slot keys (smart/rush/oracle/...)
  const legacySlotByModel = {
    "claude-opus-4-6": "smart",
    "gpt-5.3-codex": "deep",
    "claude-sonnet-4-5": "librarian",
    "claude-sonnet-4-5-20241022": "librarian",
    "claude-haiku-4-5": "rush",
    "claude-haiku-4-5-20251001": "rush",
    "gemini-3-flash-preview": "search",
    "gpt-5.2": "oracle",
    "gemini-3-pro-preview": "review",
    "gemini-2.5-flash": "handoff",
    "gemini-2.5-flash-lite-preview-09-2025": "topics",
  };

  const legacySlot = legacySlotByModel[requestedModel];
  if (legacySlot && ampModelMappings[legacySlot]) return ampModelMappings[legacySlot];

  return null;
}

export async function POST(request, { params }) {
  try {
    const { provider, path } = await params;
    const pathSegments = Array.isArray(path) ? path : [path];
    const fullPath = pathSegments.join("/");

    // Validate authentication
    const apiKey = extractApiKeyFromRequest(request);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    // Get settings for Amp configuration
    const settings = await getSettings();
    const { ampUpstreamUrl, ampUpstreamApiKey, ampModelMappings } = settings;

    // Validate API key (check against locally stored keys or default)
    const apiKeys = await getApiKeys();
    const validKey = apiKeys.find(k => k.key === apiKey && k.isActive !== false)
      || apiKey === "sk_9router"
      || apiKey === ampUpstreamApiKey
      || apiKey.startsWith("sgamp_user");
    if (!validKey) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    // Parse request body to get model
    const body = await request.json();
    const requestedModel = body.model;

    // Check if this model is mapped locally
    const localModel = resolveMappedModel(ampModelMappings, requestedModel);

    if (localModel) {
      // Route to local 9router provider
      console.log(`[Amp Proxy] Routing ${requestedModel} to local model: ${localModel}`);

      // Preserve original API shape so format detection stays correct
      const originalUrl = new URL(request.url);
      const internalPath = fullPath ? `/api/${fullPath}` : "/api/v1/chat/completions";
      const internalUrl = new URL(`${internalPath}${originalUrl.search}`, request.url);

      // Update body with mapped model
      const modifiedBody = {
        ...body,
        model: localModel,
      };

      // Use special internal proxy header to bypass auth
      const response = await fetch(internalUrl.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Proxy": "true",
        },
        body: JSON.stringify(modifiedBody),
      });

      // Stream the response back (handles both streaming and non-streaming)
      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/json",
          "Cache-Control": "no-cache",
        },
      });
    } else {
      // Forward to ampcode.com
      console.log(`[Amp Proxy] Forwarding ${requestedModel} to upstream: ${ampUpstreamUrl}`);

      if (!ampUpstreamUrl || !ampUpstreamApiKey) {
        return NextResponse.json(
          { error: "Amp upstream not configured. Please configure in Settings." },
          { status: 500 }
        );
      }

      const upstreamUrl = `${ampUpstreamUrl}/api/provider/${provider}/${fullPath}`;

      const response = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ampUpstreamApiKey}`,
        },
        body: JSON.stringify(body),
      });

      // Stream the response back as-is (supports SSE streaming)
      return new Response(response.body, {
        status: response.status,
        headers: {
          "Content-Type": response.headers.get("Content-Type") || "application/json",
          "Cache-Control": "no-cache",
        },
      });
    }
  } catch (error) {
    console.error("[Amp Proxy] Error:", error);
    return NextResponse.json(
      { error: error.message || "Proxy request failed" },
      { status: 500 }
    );
  }
}

// Support GET for model listing endpoints
export async function GET(request, { params }) {
  try {
    const { provider, path } = await params;
    const pathSegments = Array.isArray(path) ? path : [path];
    const fullPath = pathSegments.join("/");

    const apiKey = extractApiKeyFromRequest(request);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing authorization header" },
        { status: 401 }
      );
    }

    const settings = await getSettings();
    const { ampUpstreamUrl, ampUpstreamApiKey } = settings;

    const apiKeys = await getApiKeys();
    const validKey = apiKeys.find(k => k.key === apiKey && k.isActive !== false)
      || apiKey === "sk_9router"
      || apiKey === ampUpstreamApiKey
      || apiKey.startsWith("sgamp_user");
    if (!validKey) {
      return NextResponse.json(
        { error: "Invalid API key" },
        { status: 401 }
      );
    }

    if (!ampUpstreamUrl || !ampUpstreamApiKey) {
      return NextResponse.json(
        { error: "Amp upstream not configured" },
        { status: 500 }
      );
    }

    const upstreamUrl = `${ampUpstreamUrl}/api/provider/${provider}/${fullPath}`;

    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${ampUpstreamApiKey}`,
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("[Amp Proxy] Error:", error);
    return NextResponse.json(
      { error: error.message || "Proxy request failed" },
      { status: 500 }
    );
  }
}
