import { resolveOllamaLocalHost } from "../../config/providers.js";
import { responseToBase64, throwUpstreamError } from "./_base.js";

const DEFAULT_MODEL = "phonon:multilingual";
const DEFAULT_VOICE = "default";
const KNOWN_PHONON_VOICES = new Set(["default", "zoey", "easton", "freya"]);

export default {
  async synthesize(text, model, credentials, responseFormat = "mp3") {
    const rawHost = resolveOllamaLocalHost(credentials);
    const host = String(rawHost)
      .replace(/\/+$/, "")
      .replace(/\/v1\/audio\/speech$/, "")
      .replace(/\/v1$/, "");

    let ttsModel = DEFAULT_MODEL;
    let voice = DEFAULT_VOICE;

    if (model) {
      const parts = String(model).split("/").filter(Boolean);
      if (parts.length >= 2) {
        ttsModel = parts[0];
        voice = parts.slice(1).join("/");
      } else if (parts.length === 1) {
        const val = parts[0];
        if (val.startsWith("phonon")) {
          ttsModel = val;
          voice = DEFAULT_VOICE;
        } else {
          // If val does not start with phonon, treat it as a voice name with default model
          ttsModel = DEFAULT_MODEL;
          voice = val;
        }
      }
    }

    // Ollama /v1/audio/speech natively supports "wav" or "pcm".
    // If client requested "mp3" or "json" (or unspecified), request "wav" from Ollama.
    const upstreamFormat = (responseFormat === "pcm") ? "pcm" : "wav";

    const payload = {
      model: ttsModel,
      input: text,
      voice,
      response_format: upstreamFormat,
    };

    const headers = {
      "Content-Type": "application/json",
    };
    if (credentials?.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
    }

    let res;
    try {
      res = await fetch(`${host}/v1/audio/speech`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      // If requested phonon model 404s, discover installed phonon tags or fallback
      if (!res.ok && res.status === 404 && ttsModel.startsWith("phonon")) {
        let altModel = null;
        try {
          const tagsRes = await fetch(`${host}/api/tags`).catch(() => null);
          if (tagsRes && tagsRes.ok) {
            const data = await tagsRes.json().catch(() => ({}));
            const installedModels = (data.models || []).map((m) => m.name || m.model).filter(Boolean);
            const found = installedModels.find((m) => m.startsWith("phonon") && m !== ttsModel);
            if (found) altModel = found;
          }
        } catch {}

        if (!altModel) {
          altModel = ttsModel === "phonon" ? "phonon:multilingual" : ttsModel === "phonon:multilingual" ? "phonon:latest" : null;
        }

        if (altModel) {
          const retryModelRes = await fetch(`${host}/v1/audio/speech`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...payload, model: altModel }),
          });
          if (retryModelRes.ok) {
            return responseToBase64(retryModelRes, responseFormat || "wav");
          }
          // If altModel gave a 400 (e.g. voice mismatch), continue to voice fallback below
          res = retryModelRes;
          ttsModel = altModel;
        }
      }

      // If requested voice is not supported by this checkpoint, fallback to "default" voice
      if (!res.ok && res.status === 400 && voice !== DEFAULT_VOICE) {
        const errText = await res.clone().text().catch(() => "");
        if (errText.includes("voice") && errText.includes("not found")) {
          const retryVoiceRes = await fetch(`${host}/v1/audio/speech`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...payload, model: ttsModel, voice: DEFAULT_VOICE }),
          });
          if (retryVoiceRes.ok) {
            return responseToBase64(retryVoiceRes, responseFormat || "wav");
          }
        }
      }
    } catch (err) {
      if (err.cause?.code === "ECONNREFUSED" || err.code === "ECONNREFUSED" || err.message?.includes("fetch failed")) {
        throw new Error(`Cannot connect to Ollama at ${host}. Please ensure Ollama is running (e.g. 'ollama serve').`);
      }
      throw err;
    }

    if (!res.ok) {
      await throwUpstreamError(res);
    }

    return responseToBase64(res, responseFormat || "wav");
  },
};
