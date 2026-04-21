import { NextResponse } from "next/server";

import { getOpenCodePreferences, updateOpenCodePreferences } from "@/models";
import { sanitizeOpenCodePreferencesForResponse } from "@/lib/opencodeSync/schema.js";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export async function GET() {
  try {
    const preferences = await getOpenCodePreferences();
    return NextResponse.json({
      preferences: sanitizeOpenCodePreferencesForResponse(preferences),
    });
  } catch (error) {
    console.log("Error loading OpenCode preferences:", error);
    return NextResponse.json({ error: "Failed to load OpenCode preferences" }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const payload = await request.json();

    if (!isPlainObject(payload)) {
      return NextResponse.json({ error: "Invalid preferences payload" }, { status: 400 });
    }

    const preferences = await updateOpenCodePreferences(payload);

    return NextResponse.json({
      preferences: sanitizeOpenCodePreferencesForResponse(preferences),
    });
  } catch (error) {
    if (error instanceof SyntaxError || error?.message?.startsWith("Invalid") || error?.message?.includes("only valid")) {
      return NextResponse.json({ error: error?.message || "Invalid preferences payload" }, { status: 400 });
    }

    console.log("Error updating OpenCode preferences:", error);
    return NextResponse.json({ error: "Failed to update OpenCode preferences" }, { status: 500 });
  }
}
