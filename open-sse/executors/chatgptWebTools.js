// Tool-call emulation helpers for web-cookie executors.
//
// Web-cookie providers (Perplexity Web, Gemini Web, etc.) may have no native
// function calling. When the OpenAI request carries `tools`, the prompt-side
// shim (`prepareToolMessages` in ../translator/webTools.js) injects a `<tool>`
// contract; on the response side we parse `<tool>{...}</tool>` blocks back
// into OpenAI `tool_calls`.
//
// The whole tool-mode orchestration lives here — provider-agnostic — so each
// executor only gains an import + a single delegating call. Despite the
// filename (kept from the first caller), this module is shared:
// `buildToolModeResponse()` accepts an `idSeed` so every provider gets its own
// `tool_calls[].id` prefix.

import { buildToolAwareResult } from "../translator/webTools.js";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "X-Accel-Buffering": "no",
};

function sseChunk(data) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * Parse any `<tool>` blocks in a buffered JSON completion's assistant content
 * into OpenAI tool_calls and rewrite the choice. On parse failure the original
 * body passes through untouched.
 */
async function applyToolCallsToJsonResponse(response, requestedTools, idSeed) {
  const bodyText = await response.text();
  try {
    const json = JSON.parse(bodyText);
    const rawContent = json?.choices?.[0]?.message?.content || "";
    const { content, toolCalls, finishReason } = buildToolAwareResult(
      rawContent,
      requestedTools,
      idSeed
    );
    if (toolCalls) {
      json.choices[0].message = { role: "assistant", content: null, tool_calls: toolCalls };
      json.choices[0].finish_reason = finishReason;
    } else {
      json.choices[0].message.content = content;
    }
    return new Response(JSON.stringify(json), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(bodyText, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Replay an already-built OpenAI `chat.completion` object as a buffered SSE
 * stream: a role chunk, one delta per tool call, then a terminal chunk carrying
 * `finish_reason`. Every `delta.tool_calls` entry carries `index` — clients
 * accumulate parallel calls by that field, and a missing index collapses them
 * into the first slot. No token-by-token streaming while tools are active.
 */
function toolCompletionToSseStream(completion, cid, created, model) {
  const encoder = new TextEncoder();
  const choice = completion?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const finishReason = choice.finish_reason ?? "stop";
  const chunk = (delta, fr) =>
    encoder.encode(
      sseChunk({
        id: cid,
        object: "chat.completion.chunk",
        created,
        model,
        system_fingerprint: null,
        choices: [{ index: 0, delta, finish_reason: fr, logprobs: null }],
      })
    );

  return new ReadableStream({
    start(controller) {
      controller.enqueue(chunk({ role: "assistant" }, null));
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        message.tool_calls.forEach((call, index) => {
          controller.enqueue(chunk({ tool_calls: [{ index, ...call }] }, null));
        });
        controller.enqueue(chunk({}, finishReason));
      } else {
        controller.enqueue(chunk({ content: message.content ?? "" }, finishReason));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

/**
 * Tool mode: parse `<tool>` blocks in an already-buffered JSON completion into
 * tool_calls, then return either the JSON completion (non-streaming) or a
 * terminal SSE replay of it (streaming).
 */
export async function buildToolModeResponse(bufferedJson, requestedTools, stream, meta) {
  if (!bufferedJson.ok) return bufferedJson;
  const jsonResponse = await applyToolCallsToJsonResponse(
    bufferedJson,
    requestedTools,
    meta.idSeed ?? "cgpt"
  );
  if (!stream) return jsonResponse;
  const completion = await jsonResponse.json();
  return new Response(toolCompletionToSseStream(completion, meta.cid, meta.created, meta.model), {
    status: 200,
    headers: SSE_HEADERS,
  });
}
