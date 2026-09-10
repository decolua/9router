import { NextResponse } from "next/server";
import { CHAT_COMPLETION_ENDPOINTS, getEndpointConfig } from "@/app/(dashboard)/dashboard/chat-completions/requestTemplates";

const ALLOWED_PATHS = new Set(CHAT_COMPLETION_ENDPOINTS.map((item) => item.path));

function buildHeaders(endpointPath, apiKey) {
  const headers = {
    "content-type": "application/json",
  };

  if (endpointPath === "/api/v1/messages" || endpointPath === "/api/v1/messages/count_tokens") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return headers;
  }

  headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { endpointId, apiKey, body: requestBody } = body || {};

    if (!endpointId || !apiKey) {
      return NextResponse.json({ error: "endpointId and apiKey are required" }, { status: 400 });
    }

    const endpoint = getEndpointConfig(endpointId);
    if (!endpoint || !ALLOWED_PATHS.has(endpoint.path)) {
      return NextResponse.json({ error: "Unsupported endpoint path" }, { status: 400 });
    }

    if (endpoint.method === "POST" && (!requestBody || typeof requestBody !== "object")) {
      return NextResponse.json({ error: "body is required for POST endpoints" }, { status: 400 });
    }

    const url = new URL(endpoint.path, request.url);

    const upstreamResponse = await fetch(url.toString(), {
      method: endpoint.method,
      headers: buildHeaders(endpoint.path, apiKey),
      body: endpoint.method === "POST" ? JSON.stringify(requestBody) : undefined,
      cache: "no-store",
    });

    const responseText = await upstreamResponse.text();

    return NextResponse.json({
      ok: upstreamResponse.ok,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      contentType: upstreamResponse.headers.get("content-type") || "",
      body: responseText,
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to test chat completion request" }, { status: 500 });
  }
}
