// Google Gemini adapter (Nano Banana models)
import { nowSec } from "./_base.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export default {
  buildUrl: (model, creds) => {
    const apiKey = creds?.apiKey || creds?.accessToken;
    const modelId = model.replace(/^models\//, "");
    return `${BASE_URL}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model, body) => ({
    contents: [{ parts: [{ text: body.prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
  }),
  normalize: (responseBody, prompt) => {
    const parts = responseBody.candidates?.[0]?.content?.parts || [];
    const images = parts.filter((p) => p.inlineData?.data).map((p) => ({ b64_json: p.inlineData.data }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
