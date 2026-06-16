import { getApiKeys, createApiKey } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    // Parse urlencoded form data or JSON
    let body = {};
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      body = Object.fromEntries(formData.entries());
    } else {
      body = await request.json().catch(() => ({}));
    }

    const grantType = body.grant_type || "authorization_code";

    // Get an active API key to return as the token
    const keys = await getApiKeys();
    let activeKey = keys.find((k) => k.isActive)?.key;

    if (!activeKey) {
      // Auto-generate a key if none exist so the connection never fails
      const newKeyObj = await createApiKey("MCP Gateway Key", "mcp-gateway-default");
      activeKey = newKeyObj.key;
    }

    return Response.json(
      {
        access_token: activeKey,
        token_type: "Bearer",
        expires_in: 31536000, // 1 year
        refresh_token: "9router-mcp-refresh-token",
        scope: "mcp",
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          Pragma: "no-cache",
        },
      }
    );
  } catch (err) {
    console.error("[mcp-gateway] Token exchange failed:", err);
    return Response.json({ error: "server_error", error_description: err.message }, { status: 500 });
  }
}
