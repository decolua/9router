import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getProviderConnections } from "@/lib/localDb";

const langNames = new Intl.DisplayNames(["en"], { type: "language" });

/**
 * GET /api/media-providers/tts/inworld/voices[?lang=en]
 * Returns { languages, byLang } grouped by language code (same shape as edge-tts/elevenlabs)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const langFilter = searchParams.get("lang");

    const connections = await getProviderConnections({ provider: "inworld", isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) return NextResponse.json({ error: "No Inworld connection found" }, { status: 400 });

    const res = await fetch("https://api.inworld.ai/tts/v1/voices", {
      headers: { "Authorization": `Basic ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json({ error: `Inworld API ${res.status}: ${text || "Failed"}` }, { status: 502 });
    }
    const data = await res.json() as { voices?: { voiceId?: string; displayName?: string; gender?: string; languages?: string[] }[] };
    const voices = data.voices ?? [];

    const byLang: Record<string, { code: string; name: string; voices: { id: string; name: string; gender: string; lang: string }[] }> = {};
    for (const v of voices) {
      // Each voice has `languages: ["en", "es", ...]`
      const langs: string[] = Array.isArray(v.languages) && v.languages.length > 0 ? v.languages : ["en"];
      for (const code of langs) {
        if (!byLang[code]) {
          byLang[code] = {
            code,
            name: (() => { try { return langNames.of(code) ?? code; } catch { return code; } })(),
            voices: [],
          };
        }
        const voiceId = v.voiceId ?? "";
        if (!byLang[code].voices.find((x) => x.id === voiceId)) {
          byLang[code].voices.push({
            id:     voiceId,
            name:   v.displayName ?? voiceId,
            gender: v.gender ?? "",
            lang:   code,
          });
        }
      }
    }

    const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));

    if (langFilter) {
      return NextResponse.json({ voices: byLang[langFilter]?.voices ?? [] });
    }
    return NextResponse.json({ languages, byLang });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch voices";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
