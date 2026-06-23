import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { createProviderConnection } from "@/models";

const GITLAB_DEFAULT_BASE = "https://gitlab.com";

/**
 * POST /api/oauth/gitlab/pat
 * Authenticate GitLab Duo with a Personal Access Token (PAT)
 */
export async function POST(request: NextRequest) {
  try {
    let body: { token?: JsonValue; baseUrl?: JsonValue };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { token, baseUrl } = body;
    if (!token || typeof token !== "string" || !token.trim()) {
      return NextResponse.json({ error: "Personal Access Token is required" }, { status: 400 });
    }

    const base = (typeof baseUrl === "string" ? baseUrl.trim() : GITLAB_DEFAULT_BASE || GITLAB_DEFAULT_BASE).replace(/\/$/, "");

    // Verify token by fetching current user
    const userRes = await fetch(`${base}/api/v4/user`, {
      headers: { "Private-Token": token.trim(), Accept: "application/json" },
    });

    if (!userRes.ok) {
      const err = await userRes.text();
      return NextResponse.json({ error: `GitLab token verification failed: ${err}` }, { status: 401 });
    }

    const user = await userRes.json() as { email?: string; public_email?: string; name?: string; username?: string };
    const email = user.email ?? user.public_email ?? "";

    await createProviderConnection({
      provider: "gitlab",
      authType: "oauth",
      accessToken: token.trim(),
      refreshToken: null,
      expiresAt: null,
      email,
      displayName: user.name ?? user.username ?? email,
      testStatus: "active",
      providerSpecificData: {
        username: user.username ?? "",
        email,
        name: user.name ?? "",
        baseUrl: base,
        authKind: "personal_access_token",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("GitLab PAT auth error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
