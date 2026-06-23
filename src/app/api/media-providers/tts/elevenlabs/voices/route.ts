import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getProviderConnections } from "@/lib/localDb";
import { fetchElevenLabsVoices } from "open-sse/handlers/ttsCore.js";

const langNames = new Intl.DisplayNames(["en"], { type: "language" });

type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category?: string;
  is_owner?: boolean;
  labels?: { gender?: string; language?: string };
  verified_languages?: { language?: string }[];
};

/**
 * GET /api/media-providers/tts/elevenlabs/voices[?lang=en]
 * Returns { languages, byLang } grouped by language - same format as edge-tts
 * Uses direct DB read (no mutex) to avoid blocking on concurrent TTS requests
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const langFilter = searchParams.get("lang");

    // Direct DB read - bypass auth mutex used for TTS inference
    const connections = await getProviderConnections({ provider: "elevenlabs", isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) {
      return NextResponse.json({ error: "No ElevenLabs connection found" }, { status: 400 });
    }

    const voices = await fetchElevenLabsVoices(apiKey) as ElevenLabsVoice[];

    // Group by all supported languages (verified_languages + labels.language)
    const byLang: Record<string, { code: string; name: string; voices: { id: string; name: string; gender: string; lang: string; free_users_allowed: boolean }[] }> = {};
    const addToLang = (code: string, voice: ElevenLabsVoice) => {
      if (!byLang[code]) {
        byLang[code] = {
          code,
          name: (() => { try { return langNames.of(code) ?? code; } catch { return code; } })(),
          voices: [],
        };
      }
      // Avoid duplicate voice in same lang
      if (!byLang[code].voices.find((v) => v.id === voice.voice_id)) {
        byLang[code].voices.push({
          id:                voice.voice_id,
          name:              voice.name,
          gender:            voice.labels?.gender ?? "",
          lang:              code,
          // premade voices are free; professional library voices added to account may require paid plan
          free_users_allowed: voice.category === "premade" || voice.is_owner === true
        });
      }
    };
    for (const v of voices) {
      // Add to primary language
      const primaryLang = v.labels?.language ?? "en";
      addToLang(primaryLang, v);
      // Add to all verified languages
      for (const vl of v.verified_languages ?? []) {
        if (vl.language && vl.language !== primaryLang) {
          addToLang(vl.language, v);
        }
      }
    }

    const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));

    // If lang filter requested, return only that group's voices
    if (langFilter) {
      return NextResponse.json({ voices: byLang[langFilter]?.voices ?? [] });
    }

    return NextResponse.json({ languages, byLang });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch voices";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
