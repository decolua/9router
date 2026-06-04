import { randomUUID } from "crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { convertCommandCodeToOpenAI } from "../translator/response/commandcode-to-openai.js";

/**
 * CommandCodeExecutor — talks to https://api.commandcode.ai/alpha/generate
 *
 * Auth: Bearer <user_xxx> API key (stored as the connection's apiKey).
 * Adds the per-request `x-session-id` header expected by CommandCode upstream.
 *
 * Upstream returns AI SDK v5 NDJSON (one JSON event per line, no `data:` prefix).
 * We translate each event to an OpenAI chat.completion.chunk and emit it as SSE so
 * both the streaming and non-streaming (forced SSE → JSON) downstream handlers in
 * 9router can consume it without further format translation.
 */
export class CommandCodeExecutor extends BaseExecutor {
  constructor() {
    super("commandcode", PROVIDERS.commandcode);
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...(this.config.headers || {}),
      "x-session-id": randomUUID(),
    };

    const token = credentials?.apiKey || credentials?.accessToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  async execute(opts) {
    const result = await super.execute(opts);
    if (!result?.response?.ok || !result.response.body) return result;
    result.response = wrapNdjsonAsOpenAISse(result.response, opts.model);
    return result;
  }
}

function wrapNdjsonAsOpenAISse(originalResponse, model) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  const state = { model };

  const emitChunks = (chunks, controller) => {
    if (!chunks) return;
    const list = Array.isArray(chunks) ? chunks : [chunks];
    for (const c of list) {
      if (c == null) continue;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(c)}\n\n`));
    }
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Translate AI SDK v5 NDJSON line to one or more OpenAI chunks
        emitChunks(convertCommandCodeToOpenAI(trimmed, state), controller);
      }
    },
    flush(controller) {
      const trimmed = buffer.trim();
      if (trimmed) {
        emitChunks(convertCommandCodeToOpenAI(trimmed, state), controller);
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });

  const newBody = originalResponse.body.pipeThrough(transform);
  return new Response(newBody, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}

export default CommandCodeExecutor;
