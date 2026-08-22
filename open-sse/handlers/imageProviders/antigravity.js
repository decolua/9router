// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec, urlToBase64 } from "./_base.js";
import { getExecutor } from "../../executors/index.js";

// Convert image input (data URI, raw base64, or HTTP URL) to Gemini inlineData part
async function resolveImageInput(input) {
  if (!input || typeof input !== "string") return null;
  
  // Handle HTTP URLs by fetching and converting to base64
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const b64 = await urlToBase64(input);
      // For simplicity, we assume PNG or JPEG. The mimeType might not perfectly match the URL,
      // but Gemini accepts image/jpeg or image/png generically for valid base64 images.
      return { inlineData: { mimeType: "image/jpeg", data: b64 } };
    } catch (e) {
      console.warn("Failed to fetch image URL:", e.message);
      return null;
    }
  }

  // data:image/png;base64,... format
  const dataUriMatch = input.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    return { inlineData: { mimeType: dataUriMatch[1], data: dataUriMatch[2] } };
  }
  // Raw base64 string (assume PNG)
  if (/^[A-Za-z0-9+/]/.test(input) && input.length > 100) {
    return { inlineData: { mimeType: "image/png", data: input } };
  }
  return null;
}

export default {
  // Delegate to executor instead of building URL/headers/body manually
  useExecutor: true,

  // Stubs - required by imageGenerationCore interface but unused with useExecutor
  buildUrl: () => "",
  buildHeaders: () => ({}),
  buildBody: () => ({}),

  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("antigravity");
    if (!executor) throw new Error("Antigravity executor not found");

    // Build parts: text prompt + optional input image for editing
    const parts = [{ text: body.prompt }];
    const imageInput = body.image || (Array.isArray(body.images) && body.images[0]);
    if (imageInput) {
      const inlineData = await resolveImageInput(imageInput);
      if (inlineData) parts.unshift(inlineData);
    }

    const chatBody = {
      contents: [{ role: "user", parts }],
    };

    const result = await executor.execute({
      model,
      body: chatBody,
      stream: false,
      credentials,
      log,
    });

    if (!result.response.ok) {
      const text = await result.response.text();
      throw new Error(text || `HTTP ${result.response.status}`);
    }

    return result.response.json();
  },

  normalize: (responseBody, prompt) => {
    const candidates = responseBody.candidates || responseBody.response?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    
    const images = [];

    for (const p of parts) {
      if (p.inlineData?.data) {
        images.push({ b64_json: p.inlineData.data });
      } else if (p.text) {
        const b64Matches = [...p.text.matchAll(/!\[.*?\]\(data:image\/[^;]+;base64,([^)]+)\)/g)];
        for (const match of b64Matches) {
          images.push({ b64_json: match[1] });
        }
      }
    }

    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};