import { handleStt } from "@/sse/handlers/stt.js";

// Allow large audio uploads — 5min for processing large files
export const maxDuration = 300;

export async function OPTIONS(request) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const reqHeaders = request?.headers?.get("Access-Control-Request-Headers");
  if (reqHeaders) headers["Access-Control-Allow-Headers"] = reqHeaders;
  return new Response(null, { headers });
},
  });
}

/** POST /v1/audio/transcriptions - OpenAI Whisper compatible STT */
export async function POST(request) {
  return await handleStt(request);
}
