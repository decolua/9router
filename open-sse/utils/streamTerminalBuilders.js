// Graceful stream terminal synthesis for all client formats (abort path).
//
// `createDisconnectAwareStream` (streamHandler.js) calls an `onAbortTerminal`
// builder when the upstream errors mid-stream (stall timeout, socket reset,
// client close). Before ST-03 the builder was only wired for Responses
// passthrough; Claude, OpenAI Chat Completions, and the gemini-family
// (antigravity) clients closed abruptly with no terminal block, which left
// downstream clients hanging until socket timeout.
//
// This module is the single source of truth for those graceful abort
// terminals. Each builder is:
//   - pure / zero-arg (allocation-light, idempotent)
//   - byte-returning (encoded once, ready to enqueue)
//   - best-effort wrapped by the caller (try/catch around emitTerminal)
//
// The framing matches what each format's clean-completion translator emits,
// so a client cannot distinguish an aborted stream from a clean EOF.
import { FORMATS } from "../translator/formats.js";
import { formatSSE } from "./streamHelpers.js";
import { buildAbortedResponsesTerminalBytes } from "./responsesStreamHelpers.js";

const sharedEncoder = new TextEncoder();

// Re-export Responses passthrough builder so callers have one selector home.
export { buildAbortedResponsesTerminalBytes };

// OpenAI Chat Completions client format:
// finish chunk (object=chat.completion.chunk, finish_reason="stop") + data: [DONE]\n\n
export function buildAbortedOpenAIChatTerminalBytes() {
  const finishChunk = {
    id: `chatcmpl-aborted-${Date.now()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
  return sharedEncoder.encode(
    `${formatSSE(finishChunk, FORMATS.OPENAI)}data: [DONE]\n\n`,
  );
}

// Claude client format:
// message_delta (stop_reason="end_turn", zero usage) + message_stop.
// Framed via the Claude branch of formatSSE (event: <type>\ndata: {...}\n\n).
// NO data: [DONE] — Claude clients key off message_stop, and appending [DONE]
// can confuse strict implementations.
export function buildAbortedClaudeTerminalBytes() {
  const messageDelta = {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const messageStop = { type: "message_stop" };
  return sharedEncoder.encode(
    `${formatSSE(messageDelta, FORMATS.CLAUDE)}${formatSSE(messageStop, FORMATS.CLAUDE)}`,
  );
}

// Antigravity (gemini-family) client format:
// One final chunk with finishReason:"STOP", wrapped in
// { response: { candidates: [{ content: { role:"model", parts: [] }, finishReason:"STOP" }] } }
// to match the framing emitted by openai-to-antigravity.js.
//
// Gemini-family source clients (GEMINI, GEMINI_CLI, ANTIGRAVITY, VERTEX) are
// served exclusively via the antigravity decoder — CODEX_SOURCE_TO_TARGET in
// streamingHandler.js maps all of them to ANTIGRAVITY. There is no separate
// `openai-to-gemini` response translator, so a single antigravity-framed
// builder is the correct, complete terminal for the whole gemini family.
export function buildAbortedAntigravityTerminalBytes() {
  const chunk = {
    response: {
      candidates: [
        {
          content: { role: "model", parts: [] },
          finishReason: "STOP",
        },
      ],
      modelVersion: "",
      responseId: `resp-aborted-${Date.now()}`,
    },
  };
  return sharedEncoder.encode(`${formatSSE(chunk, FORMATS.ANTIGRAVITY)}`);
}

// Client sourceFormat → abort terminal builder.
// Source format = the client-facing format (not the provider format).
// Streaming handlers call this once per request to pick the right terminal;
// `null` is a valid result for formats without a synthesized terminal — the
// stream still closes gracefully, just without a structured end event.
const TERMINAL_BUILDERS = {
  [FORMATS.OPENAI_RESPONSES]: buildAbortedResponsesTerminalBytes,
  [FORMATS.CLAUDE]: buildAbortedClaudeTerminalBytes,
  [FORMATS.OPENAI]: buildAbortedOpenAIChatTerminalBytes,
  [FORMATS.GEMINI]: buildAbortedAntigravityTerminalBytes,
  [FORMATS.GEMINI_CLI]: buildAbortedAntigravityTerminalBytes,
  [FORMATS.ANTIGRAVITY]: buildAbortedAntigravityTerminalBytes,
  [FORMATS.VERTEX]: buildAbortedAntigravityTerminalBytes,
};

export function selectAbortTerminalBuilder(sourceFormat) {
  if (!sourceFormat) return null;
  return TERMINAL_BUILDERS[sourceFormat] || null;
}
