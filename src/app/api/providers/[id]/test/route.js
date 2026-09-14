import { NextResponse } from "next/server";
import { sanitizeSecrets } from "../../../../../../open-sse/handlers/videoCore.js";
import { testSingleConnection } from "./testUtils.js";

// POST /api/providers/[id]/test - Test connection
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const result = await testSingleConnection(id);

    if (result.error === "Connection not found") {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    return NextResponse.json({
      valid: result.valid,
      error: result.error,
      refreshed: result.refreshed || false,
    });
  } catch (error) {
    console.log("Error testing connection:", error);
    // The reason IS the result of a connection test. A DNS timeout, an OAuth
    // `invalid_grant` and a 401 UNAUTHENTICATED each need a different remedy, and
    // a bare "Test failed" sends the user to the server log to find out which.
    // Sanitized on the way out: an upstream error body can quote the token that
    // was just exchanged.
    const detail = sanitizeSecrets(error?.message || String(error));
    return NextResponse.json(
      { error: detail ? `Test failed: ${detail}` : "Test failed" },
      { status: 500 },
    );
  }
}
