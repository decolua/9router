import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

export async function GET(request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider") || "cloudflare-ai";
  const model = url.searchParams.get("model") || "@cf/deepseek-ai/deepseek-v4.1-flash-1017";
  const caps = getCapabilitiesForModel(provider, model);
  return Response.json({ provider, model, caps });
}
