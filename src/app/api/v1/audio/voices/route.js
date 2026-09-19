import { AI_PROVIDERS } from "@/shared/constants/providers";
import { getApiKeys } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { UPDATER_CONFIG } from "@/shared/constants/config";

const CLI_TOKEN_SALT = "9r-cli-auth";

// Same internal-credentials pattern as src/app/api/providers/[id]/test-models/route.js:
// self-fetches hit /api/* which is deny-by-default once requireLogin=true.
async function getInternalHeaders() {
  let apiKey = null;
  try {
    const keys = await getApiKeys();
    apiKey = keys.find((k) => k.isActive !== false)?.key || null;
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-9r-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

// Provider → internal voices API. Edge/local-device share the generic endpoint.
const PROVIDER_API = {
  elevenlabs: (origin) => `${origin}/api/media-providers/tts/elevenlabs/voices`,
  deepgram: (origin) => `${origin}/api/media-providers/tts/deepgram/voices`,
  inworld: (origin) => `${origin}/api/media-providers/tts/inworld/voices`,
  "edge-tts": (origin) => `${origin}/api/media-providers/tts/voices?provider=edge-tts`,
  "local-device": (origin) => `${origin}/api/media-providers/tts/voices?provider=local-device`,
};

export async function OPTIONS() {
  return new Response(null, {
    headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" },
  });
}

// GET /v1/audio/voices?provider={p}[&lang=xx]
// Returns OpenAI-style list with each voice's full model id ready for /v1/audio/speech
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");
    const lang = searchParams.get("lang");

    if (!provider || !PROVIDER_API[provider]) {
      return Response.json(
        { error: { message: `provider must be one of: ${Object.keys(PROVIDER_API).join(", ")}`, type: "invalid_request_error" } },
        { status: 400, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    // Self-fetch targets our own loopback port: request.url is derived from the
    // client-controlled Host header and must never steer this fetch (fixed-path GET SSRF).
    const internalOrigin = `http://127.0.0.1:${process.env.PORT || UPDATER_CONFIG.appPort}`;
    const baseUrl = PROVIDER_API[provider](internalOrigin);
    const url = lang ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}lang=${encodeURIComponent(lang)}` : baseUrl;
    const res = await fetch(url, { cache: "no-store", headers: await getInternalHeaders() });
    const data = await res.json();
    if (!res.ok || data.error) {
      return Response.json(
        { error: { message: data.error || `Upstream ${res.status}`, type: "server_error" } },
        { status: res.status, headers: { "Access-Control-Allow-Origin": "*" } },
      );
    }

    // Internal API shape: { voices } when lang filter, else { byLang, languages }
    const rawVoices = lang
      ? (data.voices || [])
      : Object.values(data.byLang || {}).flatMap((l) => l.voices || []);

    // Use provider alias for /v1/audio/speech model param (matches skill convention e.g. el/, dg/, edge-tts/)
    const alias = AI_PROVIDERS[provider]?.alias || provider;
    const data_out = rawVoices.map((v) => ({
      id: v.id,
      name: v.name,
      lang: v.lang || "",
      gender: v.gender || "",
      model: `${alias}/${v.id}`,
    }));

    return Response.json({ object: "list", data: data_out }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    return Response.json(
      { error: { message: err.message || "Failed", type: "server_error" } },
      { status: 502, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }
}
