import { NextResponse } from "next/server";
import { getSettings, getApiKeys } from "@/lib/localDb";

function extractToken(request) {
  const authHeader = request.headers.get("authorization");
  return authHeader ? authHeader.replace(/^Bearer\s+/i, "") : (request.headers.get("x-api-key") || "");
}

function buildUserInfoResult() {
  const now = new Date().toISOString();
  return {
    id: "local-user",
    username: "local-user",
    githubLogin: null,
    slackUserID: null,
    email: "user@localhost",
    firstName: "Local",
    lastName: "User",
    emailVerified: true,
    profilePictureUrl: null,
    lastSignInAt: now,
    createdAt: now,
    updatedAt: now,
    siteAdmin: false,
    features: [],
    mysteriousMessage: null,
    authenticated: true,
  };
}

function ok(result) {
  return NextResponse.json({ ok: true, result });
}

function fail(status, code, message) {
  return NextResponse.json({ ok: false, error: { code, message } }, { status });
}

async function validate(request) {
  const token = extractToken(request);
  if (!token) {
    return { ok: false, error: fail(401, "unauthorized", "Authorization required") };
  }

  const settings = await getSettings();
  const { ampUpstreamApiKey } = settings;

  const apiKeys = await getApiKeys();
  const validKey = apiKeys.find(k => k.key === token && k.isActive !== false)
    || token === "sk_9router"
    || token === ampUpstreamApiKey
    || token.startsWith("sgamp_user");

  if (!validKey) {
    return { ok: false, error: fail(401, "invalid_api_key", "Invalid API key") };
  }

  return { ok: true, token, settings };
}

async function readJsonBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;

  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isGetUserInfoRequest(url, body, path = "") {
  if (url.searchParams.has("getUserInfo")) return true;
  if (body?.method === "getUserInfo") return true;
  return path.includes("getuserinfo");
}

function isGetUserFreeTierStatusRequest(url, body, path = "") {
  if (url.searchParams.has("getUserFreeTierStatus")) return true;
  if (body?.method === "getUserFreeTierStatus") return true;
  return path.includes("getuserfreetierstatus");
}

async function proxyPostToUpstreamInternal(url, body, token, settings) {
  if (!settings?.ampUpstreamUrl) {
    return fail(500, "upstream_not_configured", "Amp upstream not configured");
  }

  const upstreamUrl = `${settings.ampUpstreamUrl}/api/internal${url.search}`;
  const response = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body || {}),
  });

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": contentType || "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

export async function POST(request, { params }) {
  try {
    const auth = await validate(request);
    if (!auth.ok) return auth.error;

    const url = new URL(request.url);
    const fullPath = `/${(params.path || []).join("/")}`.toLowerCase();
    const body = await readJsonBody(request);

    if (isGetUserInfoRequest(url, body, fullPath)) {
      return ok(buildUserInfoResult());
    }

    if (isGetUserFreeTierStatusRequest(url, body, fullPath)) {
      return ok({
        canUseAmpFree: false,
        isDailyGrantEnabled: false,
      });
    }

    if (body?.method && auth.token.startsWith("sgamp_user")) {
      return await proxyPostToUpstreamInternal(url, body, auth.token, auth.settings);
    }

    return fail(400, "method_not_found", "Unknown internal method");
  } catch (error) {
    console.error("[Amp Internal Catch-all API] Error:", error);
    return fail(500, "internal_error", error.message || "Internal API request failed");
  }
}

export async function GET(request, { params }) {
  try {
    const auth = await validate(request);
    if (!auth.ok) return auth.error;

    const url = new URL(request.url);
    const fullPath = `/${(params.path || []).join("/")}`.toLowerCase();

    if (isGetUserInfoRequest(url, null, fullPath)) {
      return ok(buildUserInfoResult());
    }

    if (isGetUserFreeTierStatusRequest(url, null, fullPath)) {
      return ok({
        canUseAmpFree: false,
        isDailyGrantEnabled: false,
      });
    }

    return fail(400, "method_not_found", "Unknown internal method");
  } catch (error) {
    console.error("[Amp Internal Catch-all API] Error:", error);
    return fail(500, "internal_error", error.message || "Internal API request failed");
  }
}
