// Self-hosted OpenAI-compatible TTS — POST {baseUrl}/v1/audio/speech.
//
// A SPECIAL_ADAPTER rather than a genericFormats handler on purpose: the generic
// dispatcher resolves baseUrl from the static registry entry
// (`synthesizeViaConfig` reads `cfg.baseUrl`) and never looks at the connection,
// which is exactly the limitation this provider exists to lift.
import { Buffer } from "node:buffer";

const DEFAULT_BASE_URL = "http://localhost:8880";
const DEFAULT_MODEL = "kokoro";
const DEFAULT_VOICE = "af_heart";

export default {
  async synthesize(text, model, credentials, responseFormat = "mp3") {
    // Accept either providerSpecificData.baseUrl (how the custom embedding and
    // STT providers carry it) or a bare credentials.baseUrl (how the OpenAI TTS
    // adapter does), so a connection configured either way works.
    const raw = credentials?.providerSpecificData?.baseUrl || credentials?.baseUrl || DEFAULT_BASE_URL;
    // Tolerate a baseUrl given as the full endpoint or with a trailing /v1 —
    // both are natural things to paste, and silently double-appending the path
    // would 404 with nothing pointing at the cause.
    const base = String(raw)
      .replace(/\/+$/, "")
      .replace(/\/v1\/audio\/speech$/, "")
      .replace(/\/v1$/, "");

    // The provider prefix is already stripped by getModelInfo, so `model` here is
    // "kokoro" or "kokoro/af_heart" — NOT "selfhosted-tts/...".
    //
    // A bare value is the MODEL, not the voice. The OpenAI adapter reads a bare
    // value as a voice, which is right for a service whose model is fixed
    // ("tts-1") and whose voice varies — but wrong here, where the model is the
    // variable part. Treating it as a voice sent voice="kokoro" upstream and
    // Kokoro answered 400, so `selfhosted-tts/kokoro` — the obvious way to
    // address this provider — was the one form that did not work (verified
    // against a live Kokoro through 10router, 2026-08-03).
    let ttsModel = DEFAULT_MODEL;
    let voice = DEFAULT_VOICE;
    if (model) {
      const parts = String(model).split("/").filter(Boolean);
      if (parts.length >= 2) {
        ttsModel = parts[0];
        voice = parts.slice(1).join("/");
      } else if (parts.length === 1) {
        ttsModel = parts[0];
      }
    }

    const res = await fetch(`${base}/v1/audio/speech`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(credentials?.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: ttsModel,
        voice,
        input: text,
        response_format: responseFormat,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Self-hosted TTS failed: ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return { base64: Buffer.from(buf).toString("base64"), format: responseFormat };
  },
};
