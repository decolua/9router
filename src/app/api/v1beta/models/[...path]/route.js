import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { enforceApiKeyQuota } from "@/shared/services/apiKeyQuota";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized for /v1beta/models");
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
 * POST /v1beta/models/{model}:generateContent - Gemini compatible endpoint
 * Converts Gemini format to internal format and handles via handleChat
 */
export async function POST(request, { params }) {
  const requestForBody = request.clone();
  let modelForQuota = null;
  let resolvedPath = [];
  try {
    const resolved = await params;
    const routePath = resolved?.path || [];
    resolvedPath = routePath;

    if (routePath.length >= 2) {
      const provider = routePath[0];
      const modelAction = routePath[1];
      const modelName = modelAction.replace(":generateContent", "").replace(":streamGenerateContent", "");
      modelForQuota = `${provider}/${modelName}`;
    } else if (routePath.length === 1) {
      const modelAction = routePath[0];
      modelForQuota = modelAction.replace(":generateContent", "").replace(":streamGenerateContent", "");
    }
  } catch {}

  const quota = await enforceApiKeyQuota(request, { model: modelForQuota });
  if (!quota.ok) {
    return quota.response;
  }

  await ensureInitialized();

  try {
    const path = resolvedPath;
    if (!path || path.length === 0) {
      return Response.json(
        { error: { message: "Invalid model path", code: 400 } },
        { status: 400 },
      );
    }
    // path = ["provider", "model:generateContent"] or ["model:generateContent"]
    
    let model;
    if (path.length >= 2) {
      // Format: /v1beta/models/provider/model:generateContent
      const provider = path[0];
      const modelAction = path[1];
      const modelName = modelAction.replace(":generateContent", "").replace(":streamGenerateContent", "");
      model = `${provider}/${modelName}`;
    } else {
      // Format: /v1beta/models/model:generateContent
      const modelAction = path[0];
      model = modelAction.replace(":generateContent", "").replace(":streamGenerateContent", "");
    }

    const body = await requestForBody.json();
    
    // Convert Gemini format to OpenAI/internal format
    const convertedBody = convertGeminiToInternal(body, model);
    
    // Create new request with converted body
    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(convertedBody),
    });

    return await handleChat(newRequest, null, { apiKeyId: quota.apiKeyId });
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return Response.json(
      { error: { message: error.message, code: 500 } },
      { status: 500 }
    );
  }
}

/**
 * Convert Gemini request format to internal format
 */
function convertGeminiToInternal(geminiBody, model) {
  const messages = [];

  // Convert system instruction
  if (geminiBody.systemInstruction) {
    const systemText = geminiBody.systemInstruction.parts
      ?.map(p => p.text)
      .join("\n") || "";
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  // Convert contents to messages
  if (geminiBody.contents) {
    for (const content of geminiBody.contents) {
      const role = content.role === "model" ? "assistant" : "user";
      const text = content.parts?.map(p => p.text).join("\n") || "";
      messages.push({ role, content: text });
    }
  }

  // Determine if streaming
  const stream = geminiBody.generationConfig?.stream !== false;

  return {
    model,
    messages,
    stream,
    max_tokens: geminiBody.generationConfig?.maxOutputTokens,
    temperature: geminiBody.generationConfig?.temperature,
    top_p: geminiBody.generationConfig?.topP,
  };
}

