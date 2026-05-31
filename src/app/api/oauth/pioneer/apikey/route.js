import { NextResponse } from "next/server";
import { PioneerService } from "@/lib/oauth/services/pioneer";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/pioneer/apikey
 *
 * Add a Pioneer AI account by pasting an existing pio_sk_ API key.
 * The key is validated against /list-api-keys before persistence so we
 * never store a dead credential.
 */
export async function POST(request) {
  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const apiKey = (body.apiKey || "").trim();
    const displayName = (body.name || body.displayName || "").trim();
    const priority = Number.isFinite(body.priority) ? body.priority : 1;

    if (!apiKey) {
      return NextResponse.json({ error: "API key is required" }, { status: 400 });
    }
    if (!apiKey.startsWith("pio_sk_")) {
      return NextResponse.json(
        { error: "Invalid Pioneer API key format. Expected pio_sk_..." },
        { status: 400 }
      );
    }

    const pioneer = new PioneerService();
    const validation = await pioneer.validateApiKey(apiKey);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Pioneer API key validation failed" },
        { status: 401 }
      );
    }

    const connection = await createProviderConnection({
      provider: "pioneer",
      authType: "apikey",
      name: displayName || "Pioneer AI",
      apiKey,
      priority,
      isActive: true,
      testStatus: "active",
      providerSpecificData: {
        authMethod: "apikey",
        keySource: "manual",
      },
    });

    const safe = { ...connection };
    delete safe.apiKey;
    return NextResponse.json({ success: true, connection: safe }, { status: 201 });
  } catch (error) {
    console.log("Pioneer apikey import error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to add Pioneer account" },
      { status: 500 }
    );
  }
}
