import { getApiKeys } from "@/lib/localDb";
import {
  hasDashboardOrCliAuth,
  unauthorizedResponse,
} from "@/lib/auth/dashboardApiAuth";

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (!(await hasDashboardOrCliAuth(request))) {
    return unauthorizedResponse();
  }

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
    if (grantType !== "authorization_code" && grantType !== "refresh_token") {
      return Response.json(
        { error: "unsupported_grant_type" },
        { status: 400 },
      );
    }

    const keys = await getApiKeys();
    const activeKey = keys.find((k) => k.isActive)?.key;

    if (!activeKey) {
      return Response.json(
        {
          error: "invalid_request",
          error_description: "No active API key is configured",
        },
        { status: 400 },
      );
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
      },
    );
  } catch (err) {
    console.error("[mcp-gateway] Token exchange failed:", err);
    return Response.json(
      { error: "server_error", error_description: err.message },
      { status: 500 },
    );
  }
}
