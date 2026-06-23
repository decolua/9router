import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { getProviderConnections } from "@/lib/localDb";

const MINIMAX_VOICE_ENDPOINTS: Record<string, string> = {
  minimax:      "https://api.minimax.io/v1/get_voice",
  "minimax-cn": "https://api.minimaxi.com/v1/get_voice",
};

const VOICE_GROUPS = [
  { key: "system_voice",     label: "System"    },
  { key: "voice_cloning",    label: "Cloned"    },
  { key: "voice_generation", label: "Generated" },
  { key: "music_generation", label: "Music"     },
] as const;

type VoiceEntry = { id: string; name: string; lang: string; category: string };
type LangGroup  = { code: string; name: string; voices: VoiceEntry[] };

function isJsonObject(v: JsonValue | undefined): v is Record<string, JsonValue> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function inferLanguage(voiceId: string): string {
  if (!voiceId.includes("_")) return "Custom";
  return voiceId.split("_")[0] ?? "Custom";
}

function addVoice(byLang: Record<string, LangGroup>, code: string, voice: VoiceEntry) {
  if (!byLang[code]) byLang[code] = { code, name: code, voices: [] };
  if (byLang[code].voices.some((v) => v.id === voice.id)) return;
  byLang[code].voices.push(voice);
}

function normalizeMiniMaxVoices(data: Record<string, JsonValue>): { languages: LangGroup[]; byLang: Record<string, LangGroup> } {
  const byLang: Record<string, LangGroup> = {};

  for (const group of VOICE_GROUPS) {
    const rawGroup = data[group.key];
    const items = Array.isArray(rawGroup) ? rawGroup : [];
    for (const item of items) {
      if (!isJsonObject(item)) continue;
      const voiceId = typeof item["voice_id"] === "string" ? item["voice_id"]
        : typeof item["voiceId"] === "string" ? item["voiceId"]
        : null;
      if (!voiceId) continue;
      const voiceName = typeof item["voice_name"] === "string" ? item["voice_name"]
        : typeof item["voiceName"] === "string" ? item["voiceName"]
        : voiceId;
      const lang = group.key === "system_voice" ? inferLanguage(voiceId) : "Custom";
      addVoice(byLang, lang, {
        id:       voiceId,
        name:     group.key === "system_voice" ? voiceName : `${voiceName} · ${group.label}`,
        lang,
        category: group.key,
      });
    }
  }

  const languages = Object.values(byLang).sort((a, b) => {
    if (a.code === "Custom") return 1;
    if (b.code === "Custom") return -1;
    return a.name.localeCompare(b.name);
  });
  for (const lang of languages) {
    lang.voices.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { languages, byLang };
}

/**
 * GET /api/media-providers/tts/minimax/voices[?provider=minimax|minimax-cn&voice_type=all]
 * Returns { languages, byLang } grouped for the shared TTS voice picker.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider   = searchParams.get("provider") === "minimax-cn" ? "minimax-cn" : "minimax";
    const voiceType  = searchParams.get("voice_type") ?? "all";
    const langFilter = searchParams.get("lang");

    const connections = await getProviderConnections({ provider, isActive: true });
    const apiKey = connections[0]?.apiKey;
    if (!apiKey) {
      return NextResponse.json({ error: `No ${provider} connection found` }, { status: 400 });
    }

    const endpoint = MINIMAX_VOICE_ENDPOINTS[provider];
    const res = await fetch(endpoint ?? "", {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_type: voiceType }),
    });

    const rawText = await res.text();
    let data: Record<string, JsonValue> = {};
    if (rawText) {
      try {
        const parsed = JSON.parse(rawText) as JsonValue;
        if (isJsonObject(parsed)) data = parsed;
      } catch { data = {}; }
    }

    const baseResp = data["base_resp"] ?? data["baseResp"];
    const statusCode = isJsonObject(baseResp)
      ? Number(baseResp["status_code"] ?? baseResp["statusCode"] ?? 0)
      : 0;
    const statusMessage = isJsonObject(baseResp)
      ? String(baseResp["status_msg"] ?? baseResp["statusMsg"] ?? "")
      : typeof data["message"] === "string" ? data["message"] : "";

    if (!res.ok) {
      return NextResponse.json({ error: `MiniMax API ${res.status}: ${statusMessage || rawText || "Failed"}` }, { status: 502 });
    }
    if (statusCode !== 0) {
      return NextResponse.json({ error: statusMessage || "MiniMax voice API error" }, { status: 502 });
    }

    const normalized = normalizeMiniMaxVoices(data);
    if (langFilter) {
      return NextResponse.json({ voices: normalized.byLang[langFilter]?.voices ?? [] });
    }
    return NextResponse.json(normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch MiniMax voices";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
