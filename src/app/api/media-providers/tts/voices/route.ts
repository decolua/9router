import { VOICE_FETCHERS } from "@/lib/open-sse/handlers/ttsCore";
import { NextResponse } from "next/server";

// Map locale code → country name
const LOCALE_NAMES = new Intl.DisplayNames(["en"], { type: "region" });
const LANG_NAMES   = new Intl.DisplayNames(["en"], { type: "language" });

function countryName(code: string) {
  try { return LOCALE_NAMES.of(code); } catch { return code; }
}
function langName(code: string) {
  try { return LANG_NAMES.of(code); } catch { return code; }
}

/**
 * GET /api/media-providers/tts/voices
 * Query:
 *   ?provider=edge-tts | local-device | elevenlabs  (default: edge-tts)
 *   ?lang=en     (optional filter by lang code)
 *   ?apiKey=xxx  (required for elevenlabs)
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const provider   = searchParams.get("provider") || "edge-tts";
    const langFilter = searchParams.get("lang");
    const apiKey     = searchParams.get("apiKey");

    const fetcher = (VOICE_FETCHERS as any)[provider];
    if (!fetcher) {
      return NextResponse.json({ error: `Provider '${provider}' does not support voice listing` }, { status: 400 });
    }

    // ElevenLabs requires API key
    const raw = provider === "elevenlabs" ? await fetcher(apiKey) : await fetcher();
    let voices: any[];

    if (provider === "local-device") {
      voices = raw.map((v: any) => ({
        id:      v.id,
        name:    v.name,
        locale:  v.locale.replace("_", "-"),
        lang:    v.lang,
        country: v.country,
        countryName: countryName(v.country),
        langName:    langName(v.lang),
        gender:  v.gender,
      }));
    } else if (provider === "elevenlabs") {
      voices = raw.map((v: any) => ({
        id:      v.voice_id,
        name:    v.name,
        locale:  v.labels?.language || "en",
        lang:    (v.labels?.language || "en").split("-")[0],
        country: "",
        countryName: "",
        langName:    langName((v.labels?.language || "en").split("-")[0]),
        gender:  v.labels?.gender || "",
        category: v.category,
      }));
    } else {
      // edge-tts (default)
      voices = raw.map((v: any) => {
        const [lang, country] = v.Locale.split("-");
        return {
          id:      v.ShortName,
          name:    (v.FriendlyName || v.ShortName)
            .replace("Microsoft ", "")
            .replace(/ Online \(Natural\) - /g, " ("),
          locale:  v.Locale,
          lang,
          country: country || "",
          countryName: countryName(country || lang),
          langName:    langName(lang),
          gender:  v.Gender,
        };
      });
    }

    // Apply filter
    if (langFilter) voices = voices.filter((v: any) => v.lang === langFilter);

    // Group by language
    const byLang: Record<string, any> = {};
    for (const v of voices) {
      const key = v.lang;
      if (!byLang[key]) byLang[key] = { code: key, name: v.langName, voices: [] };
      byLang[key].voices.push(v);
    }

    // Sorted language list
    const languages = Object.values(byLang).sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({ voices, languages, byLang });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch voices" }, { status: 502 });
  }
}
