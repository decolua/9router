// OpenRouter TTS — via chat completions + audio modality (SSE stream)
export default {
  async synthesize(text, model, credentials) {
    if (!credentials?.apiKey) throw new Error("No OpenRouter API key configured");

    // model format: "tts-model/voice" e.g. "openai/gpt-4o-mini-tts/alloy"
    let ttsModel = "openai/gpt-4o-mini-tts";
    let voice = "alloy";
    if (model && model.includes("/")) {
      const lastSlash = model.lastIndexOf("/");
      const maybVoice = model.slice(lastSlash + 1);
      const maybeModel = model.slice(0, lastSlash);
      if (maybeModel.includes("/")) {
        ttsModel = maybeModel;
        voice = maybVoice;
      } else {
        voice = model;
      }
    } else if (model) {
      voice = model;
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${credentials.apiKey}`,
        "HTTP-Referer": "https://endpoint-proxy.local",
        "X-Title": "Endpoint Proxy",
      },
      body: JSON.stringify({
        model: ttsModel,
        modalities: ["text", "audio"],
        audio: { voice, format: "wav" },
        stream: true,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenRouter TTS failed: ${res.status}`);
    }

    // Parse SSE stream, accumulate base64 audio chunks
    const chunks = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        try {
          const json = JSON.parse(line.slice(6));
          const audioData = json.choices?.[0]?.delta?.audio?.data;
          if (audioData) chunks.push(audioData);
        } catch {}
      }
    }

    if (chunks.length === 0) throw new Error("OpenRouter TTS returned no audio data");
    return { base64: chunks.join(""), format: "wav" };
  },
};
