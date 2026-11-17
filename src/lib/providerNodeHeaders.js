// Resolve a compatible node's custom outbound headers at request time.
// Headers live on the provider node only (never copied onto connections), so
// every outbound path (chat, model discovery, connection test) reads them here.
import { getProviderNodeById } from "@/lib/localDb";
import { supportsCustomHeaders } from "open-sse/utils/customHeaders.js";

export async function getNodeCustomHeaders(provider) {
  if (!supportsCustomHeaders(provider)) return [];
  try {
    const node = await getProviderNodeById(provider);
    return Array.isArray(node?.customHeaders) ? node.customHeaders : [];
  } catch (error) {
    console.warn(`[customHeaders] failed to load node headers for ${provider}: ${error?.message || error}`);
    return [];
  }
}
