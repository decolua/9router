import { NextResponse } from "next/server";
import {
  getModelOverride,
  getModelOverrides,
  setModelOverride,
  deleteModelOverride,
} from "@/lib/db/repos/modelOverridesRepo.js";

// Valid metadata fields that can be overridden
const VALID_FIELDS = [
  "contextWindow",
  "maxOutput",
  "reasoning",
  "tools",
  "vision",
  "pdf",
  "audioInput",
  "videoInput",
  "imageOutput",
  "audioOutput",
  "search",
  "thinkingFormat",
  "thinkingCanDisable",
  "thinkingRange",
];

// Validate override values
function validateOverride(override) {
  const errors = [];
  for (const [key, value] of Object.entries(override)) {
    if (!VALID_FIELDS.includes(key)) {
      errors.push(`Unknown field: ${key}`);
      continue;
    }
    if (["contextWindow", "maxOutput"].includes(key)) {
      if (typeof value !== "number" || value < 0 || !Number.isInteger(value)) {
        errors.push(`${key} must be a non-negative integer`);
      }
    }
    if (["reasoning", "tools", "vision", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "search", "thinkingCanDisable"].includes(key)) {
      if (typeof value !== "boolean") {
        errors.push(`${key} must be a boolean`);
      }
    }
    if (key === "thinkingFormat" && value !== null && typeof value !== "string") {
      errors.push(`${key} must be a string or null`);
    }
    if (key === "thinkingRange") {
      if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
        errors.push(`${key} must be an object or null`);
      } else if (value !== null) {
        if (value.min !== undefined && (typeof value.min !== "number" || value.min < 0)) {
          errors.push("thinkingRange.min must be a non-negative number");
        }
        if (value.max !== undefined && (typeof value.max !== "number" || value.max < 0)) {
          errors.push("thinkingRange.max must be a non-negative number");
        }
      }
    }
  }
  return errors;
}

// GET /api/models/overrides?provider=<alias> — list overrides
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || undefined;
    const overrides = await getModelOverrides(provider);
    return NextResponse.json({ overrides });
  } catch (error) {
    console.log("Error fetching model overrides:", error);
    return NextResponse.json({ error: "Failed to fetch overrides" }, { status: 500 });
  }
}

// PUT /api/models/overrides — set/update override
export async function PUT(request) {
  try {
    const { provider, model, override } = await request.json();

    if (!provider || !model) {
      return NextResponse.json({ error: "provider and model are required" }, { status: 400 });
    }
    if (!override || typeof override !== "object") {
      return NextResponse.json({ error: "override must be an object" }, { status: 400 });
    }

    const errors = validateOverride(override);
    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    await setModelOverride(provider, model, override);
    const saved = await getModelOverride(provider, model);
    return NextResponse.json({ success: true, override: saved });
  } catch (error) {
    console.log("Error setting model override:", error);
    return NextResponse.json({ error: "Failed to set override" }, { status: 500 });
  }
}

// DELETE /api/models/overrides?provider=<alias>&model=<id> — delete override
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");

    if (!provider || !model) {
      return NextResponse.json({ error: "provider and model are required" }, { status: 400 });
    }

    await deleteModelOverride(provider, model);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting model override:", error);
    return NextResponse.json({ error: "Failed to delete override" }, { status: 500 });
  }
}
