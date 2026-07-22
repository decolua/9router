// Antigravity image adapter - delegates to the executor for correct request
// envelope (project, model, requestType, sessionId) and auth headers.
import { nowSec } from "./_base.js";
import { getExecutor } from "../../executors/index.js";
import { detectImageMime, fetchImageAsBase64, parseDataUri } from "../../translator/concerns/image.js";

// Convert image input (data URI, remote URL, or raw base64) to Gemini inlineData.
async function resolveImageInput(input) {
  if (!input || typeof input !== "string") return null;
  let parsed = parseDataUri(input);

  if (!parsed && /^https?:\/\//i.test(input)) {
    const fetched = await fetchImageAsBase64(input, { timeoutMs: 15000 });
    parsed = fetched ? parseDataUri(fetched.url) : null;
  }

  if (parsed?.mimeType?.startsWith("image/")) {
    const detectedMime = detectImageMime(Buffer.from(parsed.base64.slice(0, 32), "base64"));
    return { inlineData: { mimeType: detectedMime || parsed.mimeType, data: parsed.base64 } };
  }

  // Raw base64 string (assume PNG)
  if (/^[A-Za-z0-9+/]/.test(input) && input.length > 100 && !input.startsWith("http")) {
    return { inlineData: { mimeType: "image/png", data: input } };
  }
  return null;
}

function buildImagePrompt(prompt, referenceCount) {
  const referenceInstruction = referenceCount > 0
    ? `Use all ${referenceCount} attached reference image${referenceCount === 1 ? "" : "s"} in the result. `
    : "";
  return `Generate an image as the final response. ${referenceInstruction}Do not answer with text only.\n\n${prompt}`;
}

function parseQuotaResetAt(bodyText) {
  try {
    const data = JSON.parse(bodyText);
    const details = data?.error?.details || [];
    for (const detail of details) {
      const timestamp = detail?.metadata?.quotaResetTimeStamp;
      const resetAtMs = timestamp ? Date.parse(timestamp) : NaN;
      if (Number.isFinite(resetAtMs) && resetAtMs > Date.now()) return resetAtMs;

      const retryDelay = detail?.retryDelay;
      const delayMatch = typeof retryDelay === "string" ? retryDelay.match(/^(\d+(?:\.\d+)?)s$/) : null;
      if (delayMatch) {
        const delayMs = Number(delayMatch[1]) * 1000;
        if (Number.isFinite(delayMs) && delayMs > 0) return Date.now() + delayMs;
      }
    }
  } catch {}
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

    const imageInputs = [];
    if (Array.isArray(body.images)) imageInputs.push(...body.images);
    if (Array.isArray(body.image)) imageInputs.push(...body.image);
    else if (body.image) imageInputs.push(body.image);

    const parts = [];
    for (const input of imageInputs) {
      const inlineData = await resolveImageInput(input);
      if (!inlineData) {
        const error = new Error("Invalid reference image. Use a data URL, HTTP(S) URL, or raw base64 image.");
        error.status = 400;
        error.retryable = false;
        throw error;
      }
      parts.push(inlineData);
    }
    parts.push({ text: buildImagePrompt(body.prompt, imageInputs.length) });

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
      const error = new Error(text || `HTTP ${result.response.status}`);
      error.status = result.response.status;
      error.resetsAtMs = parseQuotaResetAt(text);
      throw error;
    }

    return result.response.json();
  },

  normalize: (responseBody, prompt) => {
    const candidates = responseBody.candidates || responseBody.response?.candidates || [];
    const parts = candidates[0]?.content?.parts || [];
    const images = parts.map((p) => p.inlineData || p.inline_data)
      .filter((inlineData) => inlineData?.data)
      .map((inlineData) => ({ b64_json: inlineData.data }));
    if (images.length === 0) {
      const text = parts.map((p) => p.text).filter(Boolean).join(" ").trim();
      throw new Error(text
        ? `Antigravity returned text instead of an image: ${text}`
        : "Antigravity did not return an image.");
    }
    return { created: nowSec(), data: images };
  },
};
