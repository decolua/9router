/**
 * OpenAI → Zed Hosted AI request translator
 * Wraps an OpenAI chat body into Zed's CompletionBody envelope with the
 * correct nested provider_request shape per upstream (Anthropic / Gemini /
 * OpenAI Responses API).
 */
import { register } from "../index.js";
import { FORMATS } from "../formats.js";
import { openaiToClaudeRequest } from "./openai-to-claude.js";
import { openaiToGeminiRequest } from "./openai-to-gemini.js";
import { openaiToOpenAIResponsesRequest } from "./openai-responses.js";
import crypto from "crypto";

export function resolveZedProvider(model) {
  const m = String(model || "").toLowerCase();
  if (/(claude|anthropic)/i.test(m)) return "anthropic";
  if (/(gemini|google)/i.test(m)) return "google";
  if (/(grok|x[_-]?ai)/i.test(m)) return "x_ai";
  return "open_ai";
}

function randomId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * @param {string} model
 * @param {object} body - OpenAI chat completion body
 * @param {boolean} stream
 */
export function openaiToZedRequest(model, body, stream = true) {
  // Already a CompletionBody
  if (body?.provider_request && body?.provider) {
    return { ...body, model: body.model || model };
  }

  const provider = resolveZedProvider(model);
  const wantStream = stream !== false;
  let providerRequest;

  if (provider === "anthropic") {
    providerRequest = openaiToClaudeRequest(model, body, wantStream);
  } else if (provider === "google") {
    providerRequest = openaiToGeminiRequest(model, body, wantStream);
  } else if (provider === "open_ai") {
    // Zed Hosted OpenAI models speak Responses API (`input` + typed content)
    providerRequest = openaiToOpenAIResponsesRequest(model, body, wantStream);
    providerRequest.stream = wantStream;
  } else {
    // x_ai — OpenAI chat-compatible
    providerRequest = { ...body, model, stream: wantStream };
    delete providerRequest.thread_id;
    delete providerRequest.prompt_id;
  }

  return {
    thread_id: body.thread_id || randomId(),
    prompt_id: body.prompt_id || randomId(),
    provider,
    model,
    provider_request: providerRequest,
  };
}

register(FORMATS.OPENAI, FORMATS.ZED, openaiToZedRequest, null);
