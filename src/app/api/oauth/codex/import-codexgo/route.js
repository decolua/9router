import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import { codexGoSafeConnection } from "@/lib/oauth/codexgoConnection";
import { useCodexGoSession } from "open-sse/services/codexGo.js";

function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const integrationToken = trimString(body?.integrationToken);
  if (!integrationToken) {
    return NextResponse.json({ error: "Integration token is required" }, { status: 400 });
  }

  try {
    const name = trimString(body?.name);
    const syncedCredentials = await useCodexGoSession(integrationToken, console);
    const connection = await createProviderConnection({
      provider: "codex",
      authType: "oauth",
      ...(name ? { name } : {}),
      ...syncedCredentials,
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: codexGoSafeConnection(connection),
    });
  } catch (error) {
    console.log("CodexGo import error:", error?.message || error);
    return NextResponse.json({ error: error.message || "Failed to import CodexGo account" }, { status: 500 });
  }
}

