import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized");
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * Strip OpenAI SDK metadata headers from incoming requests.
 * These headers (User-Agent spoofof, X-Stainless-*) can cause upstream providers
 * to reject or block requests that would otherwise succeed via plain curl.
 * @param {Request} request
 * @returns {Request}
 */
function stripSdkHeaders(request) {
  const HEADERS_TO_STRIP = [
    "user-agent",
    "x-stainless-retry-count",
    "x-stainless-timeout",
    "x-stainless-lang",
    "x-stainless-package-version",
    "x-stainless-os",
    "x-stainless-arch",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
  ];

  const headers = new Headers(request.headers);
  for (const header of HEADERS_TO_STRIP) {
    headers.delete(header);
  }
  // Restore a neutral User-Agent so the request is not blocked
  headers.set("user-agent", "9router/1.0");

  return new Request(request, { headers });
}

export async function POST(request) {
  await ensureInitialized();
  const sanitizedRequest = stripSdkHeaders(request);
  return await handleChat(sanitizedRequest);
}

