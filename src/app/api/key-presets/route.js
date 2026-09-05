import { NextResponse } from "next/server";
import { getKeyPresets, createKeyPreset } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// GET /api/key-presets - List model presets for API keys
export async function GET() {
  try {
    const presets = await getKeyPresets();
    return NextResponse.json({ presets });
  } catch (error) {
    console.log("Error fetching key presets:", error);
    return NextResponse.json({ error: "Failed to fetch presets" }, { status: 500 });
  }
}

// POST /api/key-presets - Create a new preset
export async function POST(request) {
  try {
    const body = await request.json();
    const { name, models } = body;

    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    const modelList = Array.isArray(models)
      ? models.filter((m) => typeof m === "string" && m.trim() !== "")
      : [];
    if (modelList.length === 0) {
      return NextResponse.json({ error: "At least one model is required" }, { status: 400 });
    }

    const preset = await createKeyPreset({ name: String(name).trim(), models: modelList });
    return NextResponse.json({ preset }, { status: 201 });
  } catch (error) {
    console.log("Error creating key preset:", error);
    return NextResponse.json({ error: "Failed to create preset" }, { status: 500 });
  }
}
