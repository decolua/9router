import { NextResponse } from "next/server";
import { readZedIdeCredentials } from "@/lib/oauth/utils/zedCredentials";

/**
 * GET /api/oauth/zed/auto-import
 * Read the signed-in Zed IDE session from the OS keyring/keychain.
 *
 * Linux: secret-tool (url=https://zed.dev, label zed-github-account)
 * macOS: Keychain internet password (server=https://zed.dev)
 * Windows: Credential Manager target zed:url=https://zed.dev
 *
 * Also loads system_id from Zed's local kv_store when present.
 */
export async function GET() {
  try {
    const result = await readZedIdeCredentials();
    if (!result.found) {
      return NextResponse.json({
        found: false,
        error: result.error || "Zed IDE credentials not found",
        credentialsUrl: result.credentialsUrl || null,
      });
    }

    return NextResponse.json({
      found: true,
      userId: result.userId,
      accessToken: result.accessToken,
      systemId: result.systemId,
      credentialsUrl: result.credentialsUrl,
    });
  } catch (error) {
    console.log("Zed auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message || "Failed to read Zed credentials" },
      { status: 500 },
    );
  }
}
