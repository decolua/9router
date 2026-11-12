import { listTtsVoices } from "@/lib/ttsVoices.js";
import { NextResponse } from "next/server";

/**
 * GET /api/media-providers/tts/voices
 * Query: ?provider=edge-tts|local-device|elevenlabs [&lang=en] [&apiKey=...]
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || "edge-tts";
    const data = await listTtsVoices(provider, searchParams.get("lang"), searchParams.get("apiKey"));
    return NextResponse.json(data, { status: data.error ? 400 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err.message || "Failed to fetch voices" }, { status: 502 });
  }
}
