import { NextResponse } from "next/server";
import {
  getCapsOverrides,
  setCapsOverride,
  deleteCapsOverride,
} from "@/lib/db/index.js";

export const dynamic = "force-dynamic";

const BOOL_FIELDS = [
  "vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput",
  "search", "tools", "reasoning", "thinkingCanDisable",
];
const INT_FIELDS = ["contextWindow", "maxOutput"];
const STRING_FIELDS = ["thinkingFormat"];

function validateCaps(caps) {
  if (typeof caps !== "object" || caps === null || Array.isArray(caps)) {
    return "caps must be an object";
  }
  for (const [key, value] of Object.entries(caps)) {
    if (BOOL_FIELDS.includes(key)) {
      if (typeof value !== "boolean") return `caps.${key} must be a boolean`;
    } else if (INT_FIELDS.includes(key)) {
      if (!Number.isInteger(value) || value <= 0) return `caps.${key} must be a positive integer`;
    } else if (STRING_FIELDS.includes(key)) {
      if (value !== null && typeof value !== "string") return `caps.${key} must be a string or null`;
    } else if (key === "thinkingRange") {
      if (value !== null && (typeof value !== "object" || typeof value.min !== "number" || typeof value.max !== "number")) {
        return "caps.thinkingRange must be null or { min, max }";
      }
    } else {
      return `Unknown caps field: ${key}`;
    }
  }
  return null;
}

// GET /api/models/caps - all capability overrides ({ "provider|model": caps })
export async function GET() {
  try {
    const overrides = await getCapsOverrides();
    return NextResponse.json({ overrides });
  } catch (error) {
    console.log("Error fetching caps overrides:", error);
    return NextResponse.json({ error: "Failed to fetch caps overrides" }, { status: 500 });
  }
}

// PUT /api/models/caps - set/replace override for one model
// Body: { provider, model, caps }
export async function PUT(request) {
  try {
    const body = await request.json();
    const { provider, model, caps } = body || {};
    if (!provider || !model) {
      return NextResponse.json({ error: "provider and model required" }, { status: 400 });
    }
    const validationError = validateCaps(caps);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    if (Object.keys(caps).length === 0) {
      await deleteCapsOverride(provider, model);
      return NextResponse.json({ success: true, removed: true });
    }
    await setCapsOverride(provider, model, caps);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error setting caps override:", error);
    return NextResponse.json({ error: "Failed to set caps override" }, { status: 500 });
  }
}

// DELETE /api/models/caps?provider=xxx&model=yyy - remove override (revert to static)
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    if (!provider || !model) {
      return NextResponse.json({ error: "provider and model required" }, { status: 400 });
    }
    await deleteCapsOverride(provider, model);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting caps override:", error);
    return NextResponse.json({ error: "Failed to delete caps override" }, { status: 500 });
  }
}
