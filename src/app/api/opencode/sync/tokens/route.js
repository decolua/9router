import { NextResponse } from "next/server";

import { listOpenCodeTokens, mutateOpenCodeTokens } from "@/models";
import { createSyncToken, toPublicTokenRecord } from "@/lib/opencodeSync/tokens.js";

function isValidationError(error) {
  const message = typeof error?.message === "string" ? error.message : "";
  return /^Invalid\b/u.test(message) || /required/u.test(message);
}

export async function GET() {
  try {
    const tokens = await listOpenCodeTokens();
    return NextResponse.json({
      tokens: (tokens || []).map((record) => toPublicTokenRecord(record)).filter(Boolean),
    });
  } catch (error) {
    console.log("Error loading OpenCode sync tokens:", error);
    return NextResponse.json({ error: "Failed to load OpenCode sync tokens" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await request.json();
    const { token, record } = createSyncToken(payload);
    await mutateOpenCodeTokens((tokens) => ({
      tokens: [...tokens, record],
    }));

    return NextResponse.json(
      {
        token,
        record: toPublicTokenRecord(record),
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof SyntaxError || isValidationError(error)) {
      return NextResponse.json({ error: error?.message || "Invalid token payload" }, { status: 400 });
    }

    console.log("Error creating OpenCode sync token:", error);
    return NextResponse.json({ error: "Failed to create OpenCode sync token" }, { status: 500 });
  }
}
