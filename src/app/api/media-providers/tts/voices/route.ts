import { VOICE_FETCHERS } from "open-sse/handlers/ttsCore.js";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Map locale code → country name
const LOCALE_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const LANG_NAMES   = new Intl.DisplayNames(["en"], { type: "language" });

function countryName(code: string): string {
  try { return LOCALE_NAMES.of(code) ?? code; } catch { return code; }
}
function langName(code: string): string {
  try { return LANG_NAMES.of(code) ?? code; } catch { return code; }
}

/**
 * GET /api/media-providers/tts/voices
 * Query:
 *   ?provider=edge-tts | local-device | elevenlabs  (default: edge-tts)
 *   ?lang=en     (optional filter by lang code)
 *   ?apiKey=xxx  (required for elevenlabs)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider   = searchParams.get("provider") ?? "edge-tts";
    const langFilter = searchParams.get("lang");
    const apiKey     = searchParams.get("apiKey");

    const fetcher = (VOICE_FETCHERS as Record<string, ((...args: string[]) => Promise<unknown>) | undefined>)[provider];
    if (!fetcher) {
      return NextResponse.json({ error: `Provider '${provider}' does not support voice listing` }, { status: 400 });
    }

    // ElevenLabs requires API key
    const raw = await fetcher(...(provider === "elevenlabs" && apiKey !== null ? [apiKey] : []));
    const useElevenShape = provider === "elevenlabs" || provider === "gemini";
    let voices: {
      id: string;
      name: string;
      locale: string;
      lang: string;
      country: string;
      countryName: string;
      langName: string;
      gender: string;
      category?: string;
    }[];

    if (provider === "local-device") {
      voices = (raw as { id: string; name: string; locale: string; lang: string; country: string; gender: string }[]).map((v) => ({
        id:          v.id,
        name:        v.name,
        locale:      v.locale.replace("_", "-"),
        lang:        v.lang,
        country:     v.country,
        countryName: countryName(v.country),
        langName:    langName(v.lang),
        gender:      v.gender,
      }));
    } else if (useElevenShape) {
      voices = (raw as { voice_id: string; name: string; labels?: { language?: string; gender?: string }; category?: string }[]).map((v) => ({
        id:          v.voice_id,
        name:        v.name,
        locale:      v.labels?.language ?? "en",
        lang:        (v.labels?.language ?? "en").split("-")[0] ?? "en",
        country:     "",
        countryName: "",
        langName:    langName((v.labels?.language ?? "en").split("-")[0] ?? "en"),
        gender:      v.labels?.gender ?? "",
        ...(v.category !== undefined ? { category: v.category } : {}),
      }));
    } else {
      // edge-tts (default)
      voices = (raw as { ShortName: string; FriendlyName?: string; Locale: string; Gender: string }[]).map((v) => {
        const parts = v.Locale.split("-");
        const lang = parts[0] ?? "";
        const country = parts[1] ?? "";
        return {
          id:          v.ShortName,
          name:        (v.FriendlyName ?? v.ShortName)
            .replace("Microsoft ", "")
            .replace(/ Online \(Natural\) - /g, " ("),
          locale:      v.Locale,
          lang,
          country,
          countryName: countryName(country || lang),
          langName:    langName(lang),
          gender:      v.Gender,
        };
      });
    }

    // Apply filter
    if (langFilter) voices = voices.filter((v) => v.lang === langFilter);

    // Group by language
    const byLang: Record<string, { code: string; name: string; voices: typeof voices }> = {};
    for (const v of voices) {
      const key = v.lang;
      if (!byLang[key]) byLang[key] = { code: key, name: v.langName, voices: [] };
      byLang[key].voices.push(v);
    }

    // Sorted language list
    const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ voices, languages, byLang });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch voices";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
