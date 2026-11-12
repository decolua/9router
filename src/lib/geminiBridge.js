import { geminiToOpenAIRequest } from "open-sse/translator/request/gemini-to-openai.js";

/**
 * Convert Gemini request format to OpenAI/internal format.
 *
 * @param {object} geminiBody  - parsed Gemini request body
 * @param {string} model       - resolved model string (e.g. "gemini-pro-high")
 * @param {boolean} stream     - whether to stream (from URL action)
 */
export function convertGeminiToInternal(geminiBody, model, stream) {
  // Reuse the full Gemini -> OpenAI translator. The old text-only mapping dropped tools,
  // functionCall/functionResponse parts and inline images, so a Gemini-native client
  // (e.g. Gemini CLI) could never call its tools.
  const converted = geminiToOpenAIRequest(model, geminiBody, stream);
  return { ...converted, model, stream };
}

/** OpenAI tool_calls (accumulated) => Gemini functionCall parts */
export function toolCallsToFunctionCallParts(toolCalls) {
  const parts = [];
  for (const tc of toolCalls) {
    if (!tc?.function?.name) continue;
    let args = {};
    try {
      args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
    } catch {
      args = {};
    }
    const functionCall = { name: tc.function.name, args };
    if (tc.id) functionCall.id = tc.id;
    parts.push({ functionCall });
  }
  return parts;
}

/** Map OpenAI finish_reason => Gemini finishReason */
const FINISH_REASON_MAP = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

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
export function transformOpenAISSEToGeminiSSE(upstreamResponse, model) {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  // A network chunk can end mid-line: keep the tail until the next chunk.
  let buffer = "";
  // tool_calls arrive as fragments per index; emit them whole when the turn finishes.
  const toolCalls = {};

  const handleLine = (line, controller) => {
        if (!line.startsWith("data:")) return;

        const data = line.slice(5).trim();

        // Drop empty lines and the OpenAI [DONE] sentinel.
        // Gemini SSE ends by stream close, no sentinel needed.
        if (!data || data === "[DONE]") return;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }

        const choice = parsed.choices?.[0];
        if (!choice) return;

        const delta = choice.delta || {};

        const parts = [];
        if (delta.reasoning_content) {
          parts.push({ text: delta.reasoning_content, thought: true });
        }
        if (delta.content) {
          parts.push({ text: delta.content });
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            const acc = toolCalls[idx] || (toolCalls[idx] = { id: "", function: { name: "", arguments: "" } });
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.function.name += tc.function.name;
            if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
          }
        }
        if (choice.finish_reason) {
          const indices = Object.keys(toolCalls).sort((a, b) => a - b);
          parts.push(...toolCallsToFunctionCallParts(indices.map((k) => toolCalls[k])));
          for (const k of indices) delete toolCalls[k];
        }

        // Skip pure role-only deltas with no content and no finish signal
        if (parts.length === 0 && !choice.finish_reason) return;

        const candidate = {
          content: {
            role: "model",
            parts: parts.length > 0 ? parts : [{ text: "" }],
          },
          index: 0,
        };

        if (choice.finish_reason) {
          candidate.finishReason = FINISH_REASON_MAP[choice.finish_reason] || "STOP";
        }

        const geminiChunk = { candidates: [candidate] };

        // Attach usage + modelVersion on the final chunk (when finish_reason is set)
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
  };

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line.replace(/\r$/, ""), controller);
    },
    // Gemini SSE ends by stream close (no sentinel); just drain a last unterminated line.
    flush(controller) {
      if (buffer) handleLine(buffer.replace(/\r$/, ""), controller);
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

/**
 * Convert an OpenAI chat.completion JSON response into a Gemini
 * GenerateContentResponse so that Gemini CLI can parse it.
 */
export async function convertOpenAIResponseToGemini(response, model) {
  if (!response.ok) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }

  if (body.candidates) return Response.json(body, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  if (body.error) return Response.json(body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  const choice = body.choices?.[0];
  if (!choice) {
    return Response.json(body, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const { message, finish_reason } = choice;

  const parts = [];
  if (message.reasoning_content) {
    parts.push({ text: message.reasoning_content, thought: true });
  }
  const functionCallParts = toolCallsToFunctionCallParts(message.tool_calls || []);
  if (message.content || functionCallParts.length === 0) {
    parts.push({ text: message.content || "" });
  }
  parts.push(...functionCallParts);

  const finishReason = FINISH_REASON_MAP[finish_reason] || "STOP";

  const geminiResponse = {
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

  return Response.json(geminiResponse, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

/**
 * Answer a streaming Gemini request at once and keep the connection alive while the upstream model
 * thinks. Proxies such as Cloudflare drop a request that sends nothing for 100 s (error 524); a model
 * with a long first-token delay hit that. Until the first real chunk, an empty Gemini chunk goes out
 * every `intervalMs`; then the converted upstream stream is piped through unchanged.
 *
 * @param {Promise<Response>} upstreamPromise - handleChat(...) for the converted OpenAI request
 * @param {string} model
 * @param {number} intervalMs
 */
// idleMs: an upstream that sends nothing for this long (before or between chunks) is treated as hung;
// the client gets a 504 error event instead of pings forever, so it can retry.
export function keepAliveGeminiSSE(upstreamPromise, model, intervalMs = 10000, idleMs = 240000) {
  const encoder = new TextEncoder();
  const ping = encoder.encode(
    "data: " + JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "" }] }, index: 0 }] }) + "\r\n\r\n"
  );
  let timer = null;
  const HUNG = Symbol("hung");
  const withIdle = (p) => {
    let t;
    return Promise.race([p, new Promise((r) => { t = setTimeout(() => r(HUNG), idleMs); })]).finally(() => clearTimeout(t));
  };
  const hung = (controller) => {
    clearInterval(timer);
    controller.enqueue(encoder.encode("data: " + JSON.stringify({ error: { code: 504, message: `upstream sent nothing for ${idleMs / 1000} s` } }) + "\r\n\r\n"));
    controller.close();
  };
  const body = new ReadableStream({
    async start(controller) {
      timer = setInterval(() => {
        try { controller.enqueue(ping); } catch { clearInterval(timer); }
      }, intervalMs);
      try {
        const upstream = await withIdle(upstreamPromise);
        if (upstream === HUNG) return hung(controller);
        const converted = transformOpenAISSEToGeminiSSE(upstream, model);
        if (!converted.ok || !converted.body) {
          clearInterval(timer);
          let message = `upstream ${converted.status}`;
          try { message = (await converted.text()) || message; } catch {}
          controller.enqueue(encoder.encode("data: " + JSON.stringify({ error: { code: converted.status || 500, message } }) + "\r\n\r\n"));
          controller.close();
          return;
        }
        const reader = converted.body.getReader();
        let first = true;
        for (;;) {
          const r = await withIdle(reader.read());
          if (r === HUNG) { reader.cancel().catch(() => {}); return hung(controller); }
          const { done, value } = r;
          if (done) break;
          if (first) { clearInterval(timer); first = false; }
          controller.enqueue(value);
        }
        clearInterval(timer);
        controller.close();
      } catch (e) {
        clearInterval(timer);
        controller.enqueue(encoder.encode("data: " + JSON.stringify({ error: { code: 500, message: String(e?.message || e) } }) + "\r\n\r\n"));
        controller.close();
      }
    },
    cancel() {
      clearInterval(timer);
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" },
  });
}
