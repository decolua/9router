import { handleChat } from "@/sse/handlers/chat";
import { initTranslators } from "@/lib/open-sse/translator/index";
import { NextResponse } from "next/server";

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
export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1beta/models/{model}:generateContent        — non-streaming
 * POST /v1beta/models/{model}:streamGenerateContent  — streaming (SSE)
 */
export async function POST(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  await ensureInitialized();

  try {
    const { path } = await context.params;
    // path = ["provider", "model:action"] or ["model:action"]

    let model: string;
    let action: string; // ":generateContent" | ":streamGenerateContent"

    if (path.length >= 2) {
      // Format: /v1beta/models/provider/model:generateContent
      const provider = path[0];
      const modelAction = path[1];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      const modelName = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
      model = provider + "/" + modelName;
    } else {
      // Format: /v1beta/models/model:generateContent
      const modelAction = path[0];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      model = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
    }

    const body = await request.json();

    const stream = action === ":streamGenerateContent";

    // Convert Gemini request format to OpenAI/internal format
    const convertedBody = convertGeminiToInternal(body, model, stream);

    // Create new request with converted body
    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(convertedBody),
    });

    const response = await handleChat(newRequest);

    if (stream) {
      return transformOpenAISSEToGeminiSSE(response, model);
    } else {
      return await convertOpenAIResponseToGemini(response, model);
    }
  } catch (error: any) {
    console.log("Error handling Gemini request:", error);
    return NextResponse.json(
      { error: { message: error.message, code: 500 } },
      { status: 500 }
    );
  }
}

function convertGeminiToInternal(geminiBody: any, model: string, stream: boolean) {
  const messages: any[] = [];

  if (geminiBody.systemInstruction) {
    const systemText = geminiBody.systemInstruction.parts
      ?.map((p: any) => p.text)
      .join("\n") || "";
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  if (geminiBody.contents) {
    for (const content of geminiBody.contents) {
      const role = content.role === "model" ? "assistant" : "user";
      const text = content.parts?.map((p: any) => p.text).join("\n") || "";
      messages.push({ role, content: text });
    }
  }

  return {
    model,
    messages,
    stream,
    max_tokens: geminiBody.generationConfig?.maxOutputTokens,
    temperature: geminiBody.generationConfig?.temperature,
    top_p: geminiBody.generationConfig?.topP,
  };
}

const FINISH_REASON_MAP: Record<string, string> = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

function transformOpenAISSEToGeminiSSE(upstreamResponse: Response, model: string): Response {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();

        if (!data || data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta || {};

        const parts: any[] = [];
        if (delta.reasoning_content) {
          parts.push({ text: delta.reasoning_content, thought: true });
        }
        if (delta.content) {
          parts.push({ text: delta.content });
        }

        if (parts.length === 0 && !choice.finish_reason) continue;

        const candidate: any = {
          content: {
            role: "model",
            parts: parts.length > 0 ? parts : [{ text: "" }],
          },
          index: 0,
        };

        if (choice.finish_reason) {
          candidate.finishReason = FINISH_REASON_MAP[choice.finish_reason] || "STOP";
        }

        const geminiChunk: any = { candidates: [candidate] };

        if (choice.finish_reason && parsed.usage) {
          geminiChunk.usageMetadata = {
            promptTokenCount: parsed.usage.prompt_tokens || 0,
            candidatesTokenCount: parsed.usage.completion_tokens || 0,
            totalTokenCount: parsed.usage.total_tokens || 0,
          };
          const reasoningTokens =
            parsed.usage.completion_tokens_details?.reasoning_tokens;
          if (reasoningTokens) {
            geminiChunk.usageMetadata.thoughtsTokenCount = reasoningTokens;
          }
          geminiChunk.modelVersion = parsed.model || model;
        }

        controller.enqueue(
          encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n")
        );
      }
    },
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

async function convertOpenAIResponseToGemini(response: Response, model: string): Promise<Response> {
  if (!response.ok) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }

  if (body.candidates) return NextResponse.json(body, {
    headers: { "Access-Control-Allow-Origin": "*" }
  });

  if (body.error) return NextResponse.json(body, {
    status: response.status,
    headers: { "Access-Control-Allow-Origin": "*" }
  });

  const choice = body.choices?.[0];
  if (!choice) {
    return NextResponse.json(body, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  }

  const { message, finish_reason } = choice;

  const parts: any[] = [];
  if (message.reasoning_content) {
    parts.push({ text: message.reasoning_content, thought: true });
  }
  parts.push({ text: message.content || "" });

  const finishReason = FINISH_REASON_MAP[finish_reason] || "STOP";

  const geminiResponse: any = {
    candidates: [
      {
        content: { role: "model", parts },
        finishReason,
        index: 0,
      },
    ],
    modelVersion: body.model || model,
  };

  if (body.usage) {
    geminiResponse.usageMetadata = {
      promptTokenCount: body.usage.prompt_tokens || 0,
      candidatesTokenCount: body.usage.completion_tokens || 0,
      totalTokenCount: body.usage.total_tokens || 0,
    };
    const reasoningTokens = body.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoningTokens) {
      geminiResponse.usageMetadata.thoughtsTokenCount = reasoningTokens;
    }
  }

  return NextResponse.json(geminiResponse, {
    headers: { "Access-Control-Allow-Origin": "*" }
  });
}
