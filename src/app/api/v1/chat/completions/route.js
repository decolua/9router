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
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  const reqHeaders = request?.headers?.get("Access-Control-Request-Headers");
  if (reqHeaders) headers["Access-Control-Allow-Headers"] = reqHeaders;
  return new Response(null, { headers });
}

export async function POST(request) {  
  try {
    await ensureInitialized();
    return await handleChat(request);
  } catch (err) {
    // Normalize client-abort errors to avoid uncaught error noise in logs.
    // Client closing the connection early is expected for streaming.
    if (err?.name === "AbortError" || err?.message?.includes("aborted")) {
      return new Response(null, { status: 499 });
    }
    console.error("POST /v1/chat/completions error:", err);
    return new Response(
      JSON.stringify({ error: { message: err?.message || "Internal server error", type: "server_error" } }),
      { status: 500, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  }
}

