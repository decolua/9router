import type { NextRequest } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/** Map OpenAI finish_reason => Gemini finishReason */
const FINISH_REASON_MAP: Record<string, string> = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

type GeminiPart = { text: string; thought?: boolean };
type GeminiCandidate = {
  content: { role: string; parts: GeminiPart[] };
  finishReason?: string;
  index: number;
};
type GeminiChunk = {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    thoughtsTokenCount?: number;
  };
  modelVersion?: string;
};

/** Handle CORS preflight */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * POST /v1beta/models/{model}:generateContent        — non-streaming
 * POST /v1beta/models/{model}:streamGenerateContent  — streaming (SSE)
 *
 * Streaming intent is determined by the URL action suffix (canonical Gemini API
 * convention), NOT by a body field. generationConfig.stream is not a real
 * Gemini API field and Gemini CLI never sets it.
 *
 * The @google/genai SDK always uses :streamGenerateContent?alt=sse for chat.
 * The upstream handleChat returns OpenAI SSE format; we transform it to
 * Gemini SSE format on the fly via transformOpenAISSEToGeminiSSE().
 */
export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  await ensureInitialized();

  try {
    const { path } = await context.params;
    // path = ["provider", "model:action"] or ["model:action"]

    let model: string;
    let action: string; // ":generateContent" | ":streamGenerateContent"

    // Guard: path[0]/path[1] are string|undefined under noUncheckedIndexedAccess
    const modelAction = path.length >= 2 ? path[1] : path[0];
    if (!modelAction) {
      return Response.json({ error: { message: "Invalid path", code: 400 } }, { status: 400 });
    }

    action = modelAction.includes(":streamGenerateContent")
      ? ":streamGenerateContent"
      : ":generateContent";

    if (path.length >= 2) {
      // Format: /v1beta/models/provider/model:generateContent
      const provider = path[0];
      if (!provider) {
        return Response.json({ error: { message: "Invalid path", code: 400 } }, { status: 400 });
      }
      const modelName = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
      model = provider + "/" + modelName;
    } else {
      // Format: /v1beta/models/model:generateContent
      model = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
    }

    const rawBody: JsonValue = await request.json() as JsonValue;

    // Streaming is determined by URL action suffix:
    //   :streamGenerateContent => stream: true  (SSE)
    //   :generateContent       => stream: false (plain JSON)
    const stream = action === ":streamGenerateContent";

    // Convert Gemini request format to OpenAI/internal format
    const convertedBody = convertGeminiToInternal(rawBody, model, stream);

    // Create new request with converted body
    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(convertedBody),
    });

    const response = await handleChat(newRequest);

    if (stream) {
      // Transform OpenAI SSE => Gemini SSE on the fly.
      // The @google/genai SDK always uses :streamGenerateContent?alt=sse and
      // expects Gemini SSE chunks (no [DONE] sentinel — stream just closes).
      return transformOpenAISSEToGeminiSSE(response, model);
    } else {
      // Convert OpenAI JSON response => Gemini GenerateContentResponse
      return await convertOpenAIResponseToGemini(response, model);
    }
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    const msg = error instanceof Error ? error.message : undefined;
    return Response.json(
      { error: { message: msg, code: 500 } },
      { status: 500 }
    );
  }
}

/**
 * Convert Gemini request format to OpenAI/internal format.
 *
 * geminiBody arrives as JsonValue (parsed JSON); we access fields defensively.
 */
function convertGeminiToInternal(geminiBody: JsonValue, model: string, stream: boolean) {
  const messages: Array<{ role: string; content: string }> = [];

  if (geminiBody === null || typeof geminiBody !== "object") {
    throw new TypeError("Request body must be a JSON object");
  }
  const body = geminiBody as Record<string, JsonValue>;

  // Convert system instruction
  const sysInstr = body["systemInstruction"];
  if (sysInstr !== null && typeof sysInstr === "object" && !Array.isArray(sysInstr)) {
    const parts = (sysInstr as Record<string, JsonValue>)["parts"];
    const systemText = Array.isArray(parts)
      ? parts.map(p => {
          const text = (p !== null && typeof p === "object" && !Array.isArray(p))
            ? (p as Record<string, JsonValue>)["text"]
            : undefined;
          return typeof text === "string" ? text : "";
        }).join("\n")
      : "";
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  // Convert contents to messages
  const contents = body["contents"];
  if (Array.isArray(contents)) {
    for (const content of contents) {
      if (content === null || typeof content !== "object" || Array.isArray(content)) continue;
      const c = content as Record<string, JsonValue>;
      const role = c["role"] === "model" ? "assistant" : "user";
      const parts = c["parts"];
      const text = Array.isArray(parts)
        ? parts.map(p => {
            const t = (p !== null && typeof p === "object" && !Array.isArray(p))
              ? (p as Record<string, JsonValue>)["text"]
              : undefined;
            return typeof t === "string" ? t : "";
          }).join("\n")
        : "";
      messages.push({ role, content: text });
    }
  }

  const genCfg = body["generationConfig"];
  const cfg = (genCfg !== null && typeof genCfg === "object" && !Array.isArray(genCfg))
    ? genCfg as Record<string, JsonValue>
    : null;

  return {
    model,
    messages,
    stream,
    max_tokens: typeof cfg?.["maxOutputTokens"] === "number" ? cfg["maxOutputTokens"] : undefined,
    temperature: typeof cfg?.["temperature"] === "number" ? cfg["temperature"] : undefined,
    top_p: typeof cfg?.["topP"] === "number" ? cfg["topP"] : undefined,
  };
}

/**
 * Transform an OpenAI SSE stream into a Gemini SSE stream.
 *
 * OpenAI SSE format (what handleChat returns):
 *   data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
 *   data: [DONE]
 *
 * Gemini SSE format (what @google/genai SDK expects):
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]},"index":0}]}
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]},"finishReason":"STOP","index":0}],"usageMetadata":{...}}
 *   (stream closes — no [DONE])
 */
function transformOpenAISSEToGeminiSSE(upstreamResponse: Response, model: string) {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();

        // Drop empty lines and the OpenAI [DONE] sentinel.
        // Gemini SSE ends by stream close, no sentinel needed.
        if (!data || data === "[DONE]") continue;

        let parsed: JsonValue;
        try {
          parsed = JSON.parse(data) as JsonValue;
        } catch {
          continue;
        }

        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const parsedObj = parsed as Record<string, JsonValue>;

        const choicesRaw = parsedObj["choices"];
        if (!Array.isArray(choicesRaw)) continue;
        const choiceRaw = choicesRaw[0];
        if (choiceRaw === null || typeof choiceRaw !== "object" || Array.isArray(choiceRaw)) continue;
        const choice = choiceRaw as Record<string, JsonValue>;

        const deltaRaw = choice["delta"];
        const delta = (deltaRaw !== null && typeof deltaRaw === "object" && !Array.isArray(deltaRaw))
          ? deltaRaw as Record<string, JsonValue>
          : {} as Record<string, JsonValue>;

        const parts: GeminiPart[] = [];
        if (typeof delta["reasoning_content"] === "string") {
          parts.push({ text: delta["reasoning_content"], thought: true });
        }
        if (typeof delta["content"] === "string") {
          parts.push({ text: delta["content"] });
        }

        const finishReason = choice["finish_reason"];

        // Skip pure role-only deltas with no content and no finish signal
        if (parts.length === 0 && !finishReason) continue;

        const candidate: GeminiCandidate = {
          content: {
            role: "model",
            parts: parts.length > 0 ? parts : [{ text: "" }],
          },
          index: 0,
        };

        if (typeof finishReason === "string") {
          candidate.finishReason = FINISH_REASON_MAP[finishReason] ?? "STOP";
        }

        const geminiChunk: GeminiChunk = { candidates: [candidate] };

        // Attach usage + modelVersion on the final chunk (when finish_reason is set)
        const usageRaw = parsedObj["usage"];
        if (finishReason && usageRaw !== null && typeof usageRaw === "object" && !Array.isArray(usageRaw)) {
          const usage = usageRaw as Record<string, JsonValue>;
          geminiChunk.usageMetadata = {
            promptTokenCount: typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0,
            candidatesTokenCount: typeof usage["completion_tokens"] === "number" ? usage["completion_tokens"] : 0,
            totalTokenCount: typeof usage["total_tokens"] === "number" ? usage["total_tokens"] : 0,
          };
          const detailsRaw = usage["completion_tokens_details"];
          if (detailsRaw !== null && typeof detailsRaw === "object" && !Array.isArray(detailsRaw)) {
            const rt = (detailsRaw as Record<string, JsonValue>)["reasoning_tokens"];
            if (typeof rt === "number") {
              geminiChunk.usageMetadata.thoughtsTokenCount = rt;
            }
          }
          const parsedModel = parsedObj["model"];
          geminiChunk.modelVersion = typeof parsedModel === "string" ? parsedModel : model;
        }

        controller.enqueue(
          encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n")
        );
      }
    },
    // No flush() needed: Gemini SSE ends by stream close, not a sentinel
  });

  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Convert an OpenAI chat.completion JSON response into a Gemini
 * GenerateContentResponse so that Gemini CLI can parse it.
 */
async function convertOpenAIResponseToGemini(response: Response, model: string) {
  if (!response.ok) return response;

  let body: JsonValue;
  try {
    body = await response.json() as JsonValue;
  } catch {
    return response;
  }

  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json(body, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const bodyObj = body as Record<string, JsonValue>;

  if (bodyObj["candidates"]) return Response.json(bodyObj, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

  if (bodyObj["error"]) return Response.json(bodyObj, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

  const choicesRaw = bodyObj["choices"];
  if (!Array.isArray(choicesRaw)) {
    return Response.json(bodyObj, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const choiceRaw = choicesRaw[0];
  if (choiceRaw === null || typeof choiceRaw !== "object" || Array.isArray(choiceRaw)) {
    return Response.json(bodyObj, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  const choice = choiceRaw as Record<string, JsonValue>;

  const messageRaw = choice["message"];
  const message = (messageRaw !== null && typeof messageRaw === "object" && !Array.isArray(messageRaw))
    ? messageRaw as Record<string, JsonValue>
    : {} as Record<string, JsonValue>;

  const finish_reason = choice["finish_reason"];

  const parts: GeminiPart[] = [];
  if (typeof message["reasoning_content"] === "string") {
    parts.push({ text: message["reasoning_content"], thought: true });
  }
  const contentVal = message["content"];
  parts.push({ text: typeof contentVal === "string" ? contentVal : "" });

  const finishReason = typeof finish_reason === "string"
    ? (FINISH_REASON_MAP[finish_reason] ?? "STOP")
    : "STOP";

  const modelVal = bodyObj["model"];
  const geminiResponse: {
    candidates: GeminiCandidate[];
    modelVersion: string;
    usageMetadata?: GeminiChunk["usageMetadata"];
  } = {
    candidates: [{ content: { role: "model", parts }, finishReason, index: 0 }],
    modelVersion: typeof modelVal === "string" ? modelVal : model,
  };

  const usageRaw = bodyObj["usage"];
  if (usageRaw !== null && typeof usageRaw === "object" && !Array.isArray(usageRaw)) {
    const usage = usageRaw as Record<string, JsonValue>;
    geminiResponse.usageMetadata = {
      promptTokenCount: typeof usage["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0,
      candidatesTokenCount: typeof usage["completion_tokens"] === "number" ? usage["completion_tokens"] : 0,
      totalTokenCount: typeof usage["total_tokens"] === "number" ? usage["total_tokens"] : 0,
    };
    const detailsRaw = usage["completion_tokens_details"];
    if (detailsRaw !== null && typeof detailsRaw === "object" && !Array.isArray(detailsRaw)) {
      const rt = (detailsRaw as Record<string, JsonValue>)["reasoning_tokens"];
      if (typeof rt === "number") {
        geminiResponse.usageMetadata.thoughtsTokenCount = rt;
      }
    }
  }

  return Response.json(geminiResponse, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
