import { NextResponse } from "next/server";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const connection = await getProviderConnectionById(id);

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    let isValid = false;
    let error = null;

    try {
      if (connection.authType === "apikey") {
        // Test API key
        switch (connection.provider) {
          case "openai":
            const openaiRes = await fetch("https://api.openai.com/v1/models", {
              headers: { Authorization: `Bearer ${connection.apiKey}` },
            });
            isValid = openaiRes.ok;
            break;

          case "anthropic":
            const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "x-api-key": connection.apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model: "claude-3-haiku-20240307",
                max_tokens: 1,
                messages: [{ role: "user", content: "test" }],
              }),
            });
            isValid = anthropicRes.status !== 401;
            break;

          case "gemini":
            const geminiRes = await fetch(
              `https://generativelanguage.googleapis.com/v1/models?key=${connection.apiKey}`
            );
            isValid = geminiRes.ok;
            break;

          case "openrouter":
            const openrouterRes = await fetch("https://openrouter.ai/api/v1/models", {
              headers: { Authorization: `Bearer ${connection.apiKey}` },
            });
            isValid = openrouterRes.ok;
            break;

          default:
            error = "Provider test not supported";
        }
      } else {
        // OAuth - check if token exists and not expired
        if (connection.accessToken) {
          if (connection.expiresAt) {
            const expiresAt = new Date(connection.expiresAt).getTime();
            isValid = expiresAt > Date.now();
            if (!isValid) error = "Token expired";
          } else {
            isValid = true;
          }
        } else {
          error = "No access token";
        }
      }
    } catch (err) {
      error = err.message;
      isValid = false;
    }

    // Update status in db
    await updateProviderConnection(id, {
      testStatus: isValid ? "active" : "error",
      lastError: isValid ? null : error,
      lastErrorAt: isValid ? null : new Date().toISOString(),
    });

    return NextResponse.json({
      valid: isValid,
      error: isValid ? null : error,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    return NextResponse.json({ error: "Test failed" }, { status: 500 });
  }
}
