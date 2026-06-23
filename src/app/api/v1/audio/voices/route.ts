import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { AI_PROVIDERS } from "@/shared/constants/providers";

// Provider → internal voices API. Edge/local-device share the generic endpoint.
const PROVIDER_API: Record<string, (origin: string) => string> = {
  elevenlabs: (origin) => `${origin}/api/media-providers/tts/elevenlabs/voices`,
  deepgram: (origin) => `${origin}/api/media-providers/tts/deepgram/voices`,
  inworld: (origin) => `${origin}/api/media-providers/tts/inworld/voices`,
  "edge-tts": (origin) =>
    `${origin}/api/media-providers/tts/voices?provider=edge-tts`,
  "local-device": (origin) =>
    `${origin}/api/media-providers/tts/voices?provider=local-device`,
};

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
}

// GET /v1/audio/voices?provider={p}[&lang=xx]
// Returns OpenAI-style list with each voice's full model id ready for /v1/audio/speech
export async function GET(request: NextRequest) {
  try {
    const { searchParams, origin } = new URL(request.url);
    const provider = searchParams.get("provider");
    const lang = searchParams.get("lang");

    const apiFactory = provider ? PROVIDER_API[provider] : undefined;
    if (!provider || !apiFactory) {
      return Response.json(
        {
          error: {
            message: `provider must be one of: ${Object.keys(PROVIDER_API).join(", ")}`,
            type: "invalid_request_error",
          },
        },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    const baseUrl = apiFactory(origin);
    const url = lang
      ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}lang=${encodeURIComponent(lang)}`
      : baseUrl;
    const res = await fetch(url, { cache: "no-store" });
    const data = (await res.json()) as Record<string, JsonValue>;
    if (!res.ok || data["error"]) {
      const errMsg =
        typeof data["error"] === "string" ? data["error"] : `Upstream ${res.status}`;
      return Response.json(
        { error: { message: errMsg, type: "server_error" } },
        { status: res.status, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    // Internal API shape: { voices } when lang filter, else { byLang, languages }
    interface VoiceEntry {
      id: string;
      name: string;
      lang?: string;
      gender?: string;
    }
    const rawVoices: VoiceEntry[] = lang
      ? ((data["voices"] as VoiceEntry[] | undefined) ?? [])
      : Object.values(
          (data["byLang"] as Record<string, { voices?: VoiceEntry[] }> | undefined) ?? {},
        ).flatMap((l) => l.voices ?? []);

    // Use provider alias for /v1/audio/speech model param
    const providerRecord = (AI_PROVIDERS as Record<string, { alias?: string } | undefined>)[provider];
    const alias = providerRecord?.alias ?? provider;
    const data_out = rawVoices.map((v) => ({
      id: v.id,
      name: v.name,
      lang: v.lang ?? "",
      gender: v.gender ?? "",
      model: `${alias}/${v.id}`,
    }));

    return Response.json(
      { object: "list", data: data_out },
      { headers: { "Access-Control-Allow-Origin": "*" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed";
    return Response.json(
      { error: { message, type: "server_error" } },
      { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
