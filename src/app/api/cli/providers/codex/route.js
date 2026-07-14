import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { getCliToken, CLI_TOKEN_HEADER } from "@/lib/oauth/cliCredentials";
import { extractCodexAccountInfo } from "@/lib/oauth/providers";

/**
 * POST /api/cli/providers/codex
 *
 * Persist a Codex (ChatGPT) OAuth token set pushed by the 9router CLI.
 * This is the server half of `CodexService.saveTokens()` in
 * src/lib/oauth/services/codex.js, and closes the gap where a Codex account
 * added through the CLI showed "connected successfully!" but never appeared
 * in the provider list (issue #796) — the route it POSTs to did not exist.
 *
 * Auth: the machine-derived `x-9r-cli-token` header (same contract the CLI
 * computes in cli/src/cli/api/client.js). Requests without a matching token
 * are rejected with 401.
 */
export async function POST(request) {
  try {
    const cliToken = await getCliToken();
    const provided = request.headers.get(CLI_TOKEN_HEADER);
    if (!provided || provided !== cliToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const {
      accessToken,
      refreshToken,
      expiresIn,
      lastRefreshAt,
      email: emailHint,
    } = body || {};

    if (!accessToken || typeof accessToken !== "string") {
      return NextResponse.json(
        { error: "accessToken is required" },
        { status: 400 }
      );
    }

    // Extract account info from the JWT (email, chatgptAccountId, plan).
    let email = typeof emailHint === "string" ? emailHint : null;
    const providerSpecificData = {
      authMethod: "oauth",
      lastRefreshAt: lastRefreshAt || new Date().toISOString(),
    };

    if (!email) {
      const info = extractCodexAccountInfo(accessToken);
      if (info?.email) email = info.email;
      if (info?.chatgptAccountId)
        providerSpecificData.chatgptAccountId = info.chatgptAccountId;
      if (info?.chatgptPlanType)
        providerSpecificData.chatgptPlanType = info.chatgptPlanType;
    } else if (emailHint) {
      const info = extractCodexAccountInfo(accessToken);
      if (info?.chatgptAccountId)
        providerSpecificData.chatgptAccountId = info.chatgptAccountId;
    }

    const expiresAt = expiresIn
      ? new Date(Date.now() + Number(expiresIn) * 1000).toISOString()
      : null;

    const connection = await createProviderConnection({
      provider: "codex",
      authType: "oauth",
      accessToken: accessToken.trim(),
      refreshToken: refreshToken || null,
      expiresAt,
      email: email || null,
      providerSpecificData,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        name: connection.name,
      },
    });
  } catch (error) {
    console.log("CLI codex provider save error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save Codex connection" },
      { status: 500 }
    );
  }
}
