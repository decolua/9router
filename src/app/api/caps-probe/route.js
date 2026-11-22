import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { stripUnsupportedModalities } from "open-sse/translator/concerns/modality.js";
import { FORMATS } from "open-sse/translator/formats.js";

export async function GET(request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || "cloudflare-ai";
  const model = url.searchParams.get("model") || "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
  const caps = getCapabilitiesForModel(provider, model);

  // simulate exactly what chatCore does
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const body = {
    messages: [{ role: "user", content: [
      { type: "text", text: "hello" },
      { type: "image_url", image_url: { url: "data:image/png;base64," + b64 } },
    ]}],
  };
  const stripped = stripUnsupportedModalities(body, FORMATS.OPENAI, caps);
  const contentAfter = body.messages[0].content;

  return Response.json({
    provider, model,
    vision: caps.vision,
    stripReturned: stripped,
    contentAfter,
    imageSurvived: contentAfter.some(p => p.type === "image_url"),
  });
}
