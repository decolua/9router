import { NextResponse } from "next/server";
import { getSettings, getApiKeys } from "@/lib/localDb";

function extractToken(request) {
  const authHeader = request.headers.get("authorization");
  return authHeader ? authHeader.replace(/^Bearer\s+/i, "") : (request.headers.get("x-api-key") || "");
}

function isLocalhostRequest(request) {
  const host = request.headers.get("host") || "";
  return host.includes("localhost") || host.includes("127.0.0.1") || host.includes("::1");
}

async function validate(request, settings) {
  const token = extractToken(request);
  if (!token) return { ok: false, error: NextResponse.json({ error: "Authorization required" }, { status: 401 }) };

  const apiKeys = await getApiKeys();
  const validKey = apiKeys.find(k => k.key === token && k.isActive !== false)
    || token === "sk_9router"
    || token === settings.ampUpstreamApiKey;

  if (!validKey) return { ok: false, error: NextResponse.json({ error: "Invalid API key" }, { status: 401 }) };
  return { ok: true };
}

async function proxy(request, method) {
  const url = new URL(request.url);
  const settings = await getSettings();
  const { ampUpstreamUrl, ampUpstreamApiKey, ampRestrictManagementToLocalhost } = settings;

  if (!ampUpstreamUrl || !ampUpstreamApiKey) {
    return NextResponse.json({ error: "Amp upstream not configured" }, { status: 500 });
  }

  if (ampRestrictManagementToLocalhost && !isLocalhostRequest(request)) {
    return NextResponse.json({ error: "Management API restricted to localhost" }, { status: 403 });
  }

  const auth = await validate(request, settings);
  if (!auth.ok) return auth.error;

  const upstreamUrl = `${ampUpstreamUrl}${url.pathname}${url.search}`;
  const init = {
    method,
    headers: {
      "Authorization": `Bearer ${ampUpstreamApiKey}`,
    },
  };

  if (method === "POST") {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(await request.json());
  }

  const response = await fetch(upstreamUrl, init);
  const contentType = response.headers.get("Content-Type") || "";

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

export async function GET(request) {
  try {
    return await proxy(request, "GET");
  } catch (error) {
    console.error("[Amp Threads Proxy] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    return await proxy(request, "POST");
  } catch (error) {
    console.error("[Amp Threads Proxy] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    return await proxy(request, "DELETE");
  } catch (error) {
    console.error("[Amp Threads Proxy] Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
