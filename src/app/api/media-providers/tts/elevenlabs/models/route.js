import { NextResponse } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { fetchElevenLabsModels } from "open-sse/handlers/ttsCore.js";
import { TTS_MODELS_CONFIG } from "open-sse/config/ttsModels.js";

/**
 * GET /api/media-providers/tts/elevenlabs/models
 * Live TTS models from ElevenLabs (cached 24h). Falls back to the static list when
 * there is no connection or the upstream call fails, so the picker is never empty.
 */
export async function GET() {
  const fallback = { models: TTS_MODELS_CONFIG.elevenlabs.models, source: "static" };
  try {
    const connections = await getProviderConnections({ provider: "elevenlabs", isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) return NextResponse.json(fallback);
    const models = await fetchElevenLabsModels(apiKey);
    return NextResponse.json(models.length ? { models, source: "live" } : fallback);
  } catch {
    return NextResponse.json(fallback);
  }
}
