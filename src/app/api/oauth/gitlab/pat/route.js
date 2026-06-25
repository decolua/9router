import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { guardedFetch, validatePublicUrl, UrlGuardError } from "@/lib/security/urlGuard";

const GITLAB_DEFAULT_BASE = "https://gitlab.com";
const GITLAB_URL_GUARD = { protocols: ["https:"], timeoutMs: 10000 };

/**
 * POST /api/oauth/gitlab/pat
 * Authenticate GitLab Duo with a Personal Access Token (PAT)
 */
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { token, baseUrl } = body;
    if (!token?.trim()) {
      return NextResponse.json({ error: "Personal Access Token is required" }, { status: 400 });
    }

    const base = (baseUrl?.trim() || GITLAB_DEFAULT_BASE).replace(/\/$/, "");
    await validatePublicUrl(base, GITLAB_URL_GUARD);

    // Verify token by fetching current user
    const userRes = await guardedFetch(`${base}/api/v4/user`, {
      headers: { "Private-Token": token.trim(), Accept: "application/json" },
    }, GITLAB_URL_GUARD);

    if (!userRes.ok) {
      const err = await userRes.text();
      return NextResponse.json({ error: `GitLab token verification failed: ${err}` }, { status: 401 });
    }

    const user = await userRes.json();
    const email = user.email || user.public_email || "";

    await createProviderConnection({
      provider: "gitlab",
      authType: "oauth",
      accessToken: token.trim(),
      refreshToken: null,
      expiresAt: null,
      email,
      displayName: user.name || user.username || email,
      testStatus: "active",
      providerSpecificData: {
        username: user.username || "",
        email,
        name: user.name || "",
        baseUrl: base,
        authKind: "personal_access_token",
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof UrlGuardError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("GitLab PAT auth error:", error?.message || error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
