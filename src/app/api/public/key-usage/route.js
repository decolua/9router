import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getApiKeyById, getApiKeyByValue } from "@/lib/localDb";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

function extractApiKey(request, body) {
  const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  if (body && typeof body.apiKey === "string") {
    return body.apiKey.trim();
  }
  return "";
}

function buildQuota(apiKey) {
  const requestLimit = Number(apiKey.requestLimit || 0);
  const tokenLimit = Number(apiKey.tokenLimit || 0);
  const requestUsed = Number(apiKey.requestUsed || 0);
  const tokenUsed = Number(apiKey.tokenUsed || 0);

  return {
    requestLimit,
    requestUsed,
    requestRemaining: requestLimit > 0 ? Math.max(0, requestLimit - requestUsed) : null,
    tokenLimit,
    tokenUsed,
    tokenRemaining: tokenLimit > 0 ? Math.max(0, tokenLimit - tokenUsed) : null,
  };
}

// POST /api/public/key-usage - Public read-only usage/quota lookup
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawKey = extractApiKey(request, body);
    let apiKey = null;

    if (rawKey) {
      apiKey = await getApiKeyByValue(rawKey);
      if (!apiKey) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }
    } else {
      const token = request.cookies.get("auth_token")?.value;
      if (!token) {
        return NextResponse.json({ error: "Missing API key" }, { status: 400 });
      }
      const { payload } = await jwtVerify(token, SECRET);
      if (payload?.authType !== "apiKey" || !payload?.apiKeyId) {
        return NextResponse.json({ error: "Missing API key" }, { status: 400 });
      }
      apiKey = await getApiKeyById(payload.apiKeyId);
      if (!apiKey) {
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      }
    }

    const allowedModels = Array.isArray(apiKey.allowedModels) ? apiKey.allowedModels : [];

    return NextResponse.json({
      id: apiKey.id,
      name: apiKey.name,
      createdAt: apiKey.createdAt,
      lastAccessed: apiKey.lastAccessed || null,
      allowedModels,
      quota: buildQuota(apiKey),
    });
  } catch (error) {
    console.log("Error fetching public key usage:", error);
    return NextResponse.json({ error: "Failed to fetch key usage" }, { status: 500 });
  }
}
